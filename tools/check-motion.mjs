// Проверка движения карточки обучения в настоящем браузере: появление tutIn и уход tutOut.
// Запуск: npm run check:motion (нужен Chrome или Edge; путь можно задать в CHROME).
// Поднимает dev-сервер Vite, открывает в headless Chrome ?tutorial=end_day на 375×812, 390×844 и 1440×900,
// ждёт карточку, уводит её (sedmaya.tutorial.coach.hide()) и сверяет sedmaya.tutorial.samples:
// прозрачность растёт 0 → 1 и падает 1 → 0 монотонно, есть промежуточные кадры, сдвиг уходит в 0.
// Сэмплы печатаются таблицей; при нарушении — код выхода 1. MOTION_SHOTS=<папка> — ещё и снимок
// экрана с карточкой на каждой ширине (tutorial-<ширина>.png).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STEP = process.env.MOTION_STEP || 'end_day';
const VIEWPORTS = [
  { name: 'телефон 375×812', width: 375, height: 812, mobile: true },
  { name: 'телефон 390×844', width: 390, height: 844, mobile: true },
  { name: 'компьютер 1440×900', width: 1440, height: 900, mobile: false },
];

function findChrome() {
  const list = [
    process.env.CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  const found = list.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error('Не найден Chrome: задайте путь в переменной CHROME');
  return found;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Не дождался: ${what}`);
    await sleep(100);
  }
}

/** Минимальный клиент DevTools-протокола поверх встроенного WebSocket (Node 22+). */
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const wait = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(String(e.data));
    const w = m.id && wait.get(m.id);
    if (!w) return;
    wait.delete(m.id);
    if (m.error) w.reject(new Error(m.error.message));
    else w.resolve(m.result);
  });
  const opened = new Promise((ok, fail) => {
    ws.addEventListener('open', ok, { once: true });
    ws.addEventListener('error', fail, { once: true });
  });
  return {
    opened,
    send(method, params = {}) {
      const n = ++id;
      ws.send(JSON.stringify({ id: n, method, params }));
      return new Promise((resolve, reject) => wait.set(n, { resolve, reject }));
    },
    async eval(expr) {
      const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? expr);
      return r.result.value;
    },
    close: () => ws.close(),
  };
}

/** Проверка одной фазы: монотонность, промежуточные кадры, концы. Возвращает список ошибок. */
export function checkPhase(rows, phase) {
  const errs = [];
  const up = phase === 'in';
  if (rows.length < 4) errs.push(`${phase}: кадров ${rows.length}, нужно не меньше 4`);
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    if (b.t < a.t) errs.push(`${phase}: время пошло назад (${a.t} → ${b.t} мс)`);
    if (up ? b.opacity < a.opacity - 0.001 : b.opacity > a.opacity + 0.001)
      errs.push(`${phase}: прозрачность не монотонна (${a.opacity} → ${b.opacity} на ${b.t} мс)`);
  }
  const mid = rows.filter((r) => r.opacity > 0.05 && r.opacity < 0.95).length;
  if (mid < 2) errs.push(`${phase}: промежуточных кадров ${mid}, нужно не меньше 2 (рывок вместо перехода)`);
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (first && last) {
    if (up && (first.opacity > 0.2 || Math.abs(first.dy) < 1))
      errs.push(`in: первый кадр уже виден (opacity ${first.opacity}, dy ${first.dy})`);
    if (up && (last.opacity < 0.999 || Math.abs(last.dy) > 0.05))
      errs.push(`in: последний кадр не в покое (opacity ${last.opacity}, dy ${last.dy})`);
    if (!up && first.opacity < 0.9) errs.push(`out: уход начался не с видимой карточки (${first.opacity})`);
    if (!up && last.opacity > 0.05) errs.push(`out: последний кадр ещё виден (${last.opacity})`);
    const limit = up ? 220 : 180;
    if (last.t > limit + 20) errs.push(`${phase}: длится ${last.t} мс, по макету ${limit}`);
  }
  return errs;
}

function table(rows) {
  return rows.map((r) => `    ${r.phase} ${String(r.t).padStart(4)} мс  opacity ${r.opacity.toFixed(3)}  dy ${r.dy}`).join('\n');
}

async function run() {
  const server = await createServer({
    root,
    configFile: path.join(root, 'vite.config.mts'),
    logLevel: 'error',
    server: { port: 5191, strictPort: false, host: '127.0.0.1' },
  });
  await server.listen();
  const base = server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5191/';

  const profile = path.join(root, 'node_modules', '.cache', 'check-motion');
  fs.rmSync(profile, { recursive: true, force: true });
  fs.mkdirSync(profile, { recursive: true });
  const chrome = spawn(
    findChrome(),
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--mute-audio',
      '--autoplay-policy=no-user-gesture-required',
      ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let failed = 0;
  let client = null;
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    const port = await waitFor(
      () => fs.existsSync(portFile) && fs.readFileSync(portFile, 'utf8').split('\n')[0],
      15000,
      'запуск Chrome',
    );
    const pages = await waitFor(
      async () => {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        return list.filter((t) => t.type === 'page').length ? list : null;
      },
      10000,
      'вкладка Chrome',
    );
    client = cdp(pages.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await client.opened;
    await client.send('Page.enable');
    await client.send('Runtime.enable');

    for (const vp of VIEWPORTS) {
      await client.send('Emulation.setDeviceMetricsOverride', {
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: 1,
        mobile: vp.mobile,
      });
      await client.send('Emulation.setTouchEmulationEnabled', { enabled: vp.mobile });
      await client.send('Page.navigate', { url: `${base}?tutorial=${STEP}` });
      // Появление: карточка шага и последний кадр tutIn в покое.
      await waitFor(
        () =>
          client.eval(`(() => {
            const s = window.sedmaya?.tutorial?.samples ?? [];
            const last = s[s.length - 1];
            return !!document.querySelector('.tut-layer > .tut') && !!last && last.phase === 'in' && last.opacity === 1 && last.dy === 0;
          })()`),
        30000,
        `карточка шага ${STEP} (${vp.name})`,
      );
      const shots = process.env.MOTION_SHOTS;
      if (shots) {
        const shot = await client.send('Page.captureScreenshot', { format: 'png' });
        fs.mkdirSync(shots, { recursive: true });
        fs.writeFileSync(path.join(shots, `tutorial-${vp.width}.png`), Buffer.from(shot.data, 'base64'));
      }
      // Строк в тексте карточки: высота абзаца / межстрочный интервал (план: до трёх на 390 px).
      const lines = await client.eval(`(() => {
        const p = document.querySelector('.tut-layer > .tut .tut-text');
        if (!p) return 0;
        return Math.round(p.getBoundingClientRect().height / parseFloat(getComputedStyle(p).lineHeight));
      })()`);
      const inRows = await client.eval('window.sedmaya.tutorial.samples.filter((r) => r.phase === "in")');
      // Уход: hide() ждёт конец tutOut.
      await client.eval('window.sedmaya.tutorial.coach.hide()');
      await sleep(100);
      const all = await client.eval('window.sedmaya.tutorial.samples');
      const outRows = all.filter((r) => r.phase === 'out');
      const gone = await client.eval('!document.querySelector(".tut-layer > .tut")');
      const errs = [...checkPhase(inRows, 'in'), ...checkPhase(outRows, 'out')];
      if (!gone) errs.push('out: карточка осталась на экране после ухода');
      if (lines > 3) errs.push(`текст карточки — ${lines} строки, больше трёх`);
      console.log(`${errs.length ? 'НЕТ' : 'ок '} ${vp.name}, шаг ${STEP}, строк текста: ${lines}`);
      console.log(table(inRows));
      console.log(table(outRows));
      for (const e of errs) console.log(`  ! ${e}`);
      failed += errs.length;
    }
  } finally {
    client?.close();
    chrome.kill();
    await server.close();
  }
  if (failed) {
    console.error(`Движение карточки: ${failed} нарушений`);
    process.exit(1);
  }
  console.log('Движение карточки: появление и уход плавные');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  });
}
