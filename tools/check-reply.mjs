// Проверка карточки реплики после выбора (кадр комикса, src/ui/event-window.ts + reply-art.ts):
// у каждого говорящего персонажа есть своя картинка-предмет, карточка целиком в экране и не шире его,
// проявление идёт плавно — сэмплы промежуточных значений карточки, портрета и облачка.
// Запуск: npm run check:reply (нужен Chrome или Edge; путь можно задать в CHROME).
// REPLY_SHOTS=<папка> — снимки готовой карточки и кадры проявления на каждом размере.
// REPLY_CPU=<во сколько раз> — проверить плавность на медленном процессоре.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { cdp, findChrome, sleep, waitFor } from './check-motion.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VIEWPORTS = [
  { name: 'телефон 360×640', width: 360, height: 640, mobile: true },
  { name: 'телефон 390×844', width: 390, height: 844, mobile: true },
  { name: 'компьютер 1440×900', width: 1440, height: 900, mobile: false },
];

/** Первый выбор с репликой для каждого персонажа из data/events.json. */
function speakers() {
  const raw = JSON.parse(fs.readFileSync(path.join(root, 'data', 'events.json'), 'utf8'));
  const seen = new Map();
  for (const e of raw.events ?? raw)
    (e.choices ?? []).forEach((c, i) => {
      const who = c.reply?.who;
      if (who && !seen.has(who)) seen.set(who, { who, event: e.id, choice: i });
    });
  return [...seen.values()];
}

// Сэмплы проявления: прозрачность и сдвиг карточки, масштаб картинки, масштаб облачка
const SAMPLE = `(async () => {
  const rows = [];
  const start = performance.now();
  while (!document.querySelector('.ev-reply') && performance.now() - start < 4000)
    await new Promise((r) => requestAnimationFrame(r));
  const t0 = performance.now();
  while (performance.now() - t0 < 1400) {
    const card = document.querySelector('.ev-reply');
    if (card) {
      const cs = getComputedStyle(card);
      const m = new DOMMatrix(cs.transform === 'none' ? undefined : cs.transform);
      const svg = card.querySelector('.ev-reply-face svg');
      const sm = svg ? new DOMMatrix(getComputedStyle(svg).transform === 'none' ? undefined : getComputedStyle(svg).transform) : null;
      const bub = card.querySelector('.ev-reply-bubble');
      const bm = bub ? new DOMMatrix(getComputedStyle(bub).transform === 'none' ? undefined : getComputedStyle(bub).transform) : null;
      rows.push({ t: Math.round(performance.now() - t0), op: +cs.opacity, y: +m.f.toFixed(1),
        face: sm ? +sm.a.toFixed(3) : null, bubble: bm ? +bm.a.toFixed(3) : null });
    }
    await new Promise((r) => requestAnimationFrame(r));
  }
  return rows;
})()`;

const GEOMETRY = `(() => {
  const card = document.querySelector('.ev-reply');
  const r = card.getBoundingClientRect();
  const face = card.querySelector('.ev-reply-face svg.ra');
  const text = card.querySelector('.ev-reply-text');
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: innerWidth, vh: innerHeight,
    art: !!face, figure: !!card.querySelector('.ra-figure'), text: text?.textContent ?? '' };
})()`;

async function run() {
  const server = await createServer({
    root,
    configFile: path.join(root, 'vite.config.mts'),
    logLevel: 'error',
    server: { port: 5194, strictPort: false, host: '127.0.0.1' },
  });
  await server.listen();
  const base = server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5194/';
  const profile = path.join(root, 'node_modules', '.cache', 'check-reply');
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
      ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const shots = process.env.REPLY_SHOTS;
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const shoot = async (name) => {
    if (!shots) return;
    const s = await client.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(shots, `${name}.png`), Buffer.from(s.data, 'base64'));
  };
  let failed = 0;
  let client = null;
  const fail = (msg) => {
    failed++;
    console.log(`FAIL ${msg}`);
  };
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
    // REPLY_CPU=4 — замедлить процессор, как на слабом телефоне или машине CI
    if (process.env.REPLY_CPU) await client.send('Emulation.setCPUThrottlingRate', { rate: +process.env.REPLY_CPU });
    await client.send('Runtime.enable');

    const who = speakers();
    for (const vp of VIEWPORTS) {
      await client.send('Emulation.setDeviceMetricsOverride', {
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: 1,
        mobile: vp.mobile,
      });
      await client.send('Emulation.setTouchEmulationEnabled', { enabled: vp.mobile });
      for (const [n, sp] of who.entries()) {
        await client.send('Page.navigate', { url: `${base}?event=${sp.event}` });
        await waitFor(() => client.eval(`!!document.querySelector('.ev-choice')`), 30000, `окно ${sp.event}`);
        await sleep(400);
        // Выбор с репликой, даже если по условиям закрыт: снимаем блок только для проверки вида
        await client.eval(`(() => {
          const b = document.querySelector('.ev-choice[data-choice="${sp.choice}"]');
          b.removeAttribute('aria-disabled');
          b.click();
        })()`);
        // Сэмплы — на втором персонаже каждого размера: первый показ прогревает шрифты, текстуры зерна
        // и модули Vite, и на медленной машине CI его кадры говорят о холодном старте, а не о самой анимации.
        // Остальным хватает конечного вида.
        const rows = n === 1 ? await client.eval(SAMPLE) : null;
        await waitFor(() => client.eval(`!!document.querySelector('.ev-reply')`), 5000, `реплика ${sp.who}`);
        if (rows) {
          const mid = rows.filter((r) => r.op > 0.05 && r.op < 0.95).length;
          const faceMid = rows.filter((r) => r.face && r.face > 1.01 && r.face < 1.2).length;
          const bubMid = rows.filter((r) => r.bubble && r.bubble > 0.45 && r.bubble < 0.98).length;
          const last = rows.at(-1);
          // Карточка проявляется быстро: на раннере CI при 1440×900 в окно попадают 2–3 кадра,
          // поэтому для неё хватает двух промежуточных — это ещё не рывок
          const ok = mid >= 2 && faceMid >= 3 && bubMid >= 2 && last.op === 1 && Math.abs(last.y) < 0.5 && last.face === 1;
          if (!ok) fail(`${vp.name}: проявление рывком ${JSON.stringify({ mid, faceMid, bubMid, last })}`);
          else console.log(`OK   ${vp.name}: проявление — ${mid} кадров карточки, ${faceMid} картинки, ${bubMid} облачка`);
          if (shots) fs.writeFileSync(path.join(shots, `samples-${vp.width}.json`), JSON.stringify(rows));
        } else await sleep(1300);
        const g = await client.eval(GEOMETRY);
        const inside = g.left >= 0 && g.right <= g.vw && g.top >= 0 && g.bottom <= g.vh;
        if (!g.art || !g.figure) fail(`${vp.name} ${sp.who}: нет картинки`);
        else if (!inside) fail(`${vp.name} ${sp.who}: карточка за краем ${JSON.stringify(g)}`);
        else console.log(`OK   ${vp.name} ${sp.who}: ${Math.round(g.right - g.left)}×${Math.round(g.bottom - g.top)}`);
        await client.eval(`document.querySelector('.snd-toggle')?.setAttribute('hidden', '')`);
        // Раскадровка проявления: анимации карточки ставятся на паузу в моменты T и снимаются
        if (shots && n === 1)
          for (const t of [60, 160, 280, 420, 640]) {
            await client.eval(`document.querySelector('.ev-reply').getAnimations({ subtree: true })
              .forEach((a) => { a.pause(); a.currentTime = ${t}; })`);
            await sleep(60);
            await shoot(`${vp.width}x${vp.height}-frame-${String(t).padStart(3, '0')}`);
          }
        await client.eval(`document.querySelector('.ev-reply').getAnimations({ subtree: true })
          .forEach((a) => a.finish())`);
        await shoot(`${vp.width}x${vp.height}-${sp.who}`);
        // Крупный план карточки (×2) — чтобы разглядеть печать, зерно и растр
        if (shots && vp.mobile) {
          const s = await client.send('Page.captureScreenshot', {
            format: 'png',
            clip: { x: g.left, y: g.top, width: g.right - g.left, height: g.bottom - g.top, scale: 2 },
          });
          fs.writeFileSync(path.join(shots, `card-${vp.width}-${sp.who}.png`), Buffer.from(s.data, 'base64'));
        }
      }
    }
  } finally {
    client?.close();
    chrome.kill();
    await server.close();
  }
  if (failed) {
    console.log(`\nПроблем: ${failed}`);
    process.exit(1);
  }
  console.log('\nКарточки реплик в порядке');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
