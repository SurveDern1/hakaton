// Замер плавности листания комикса на эмуляции телефона: headless Chrome, 390×844, DPR 2.75, CPU
// замедлен. Запуск: npm run perf:comic -- [comic-id], IDLE=1 — без поворота. Печатает для каждого перехода fps,
// долгие кадры, худший кадр и время стилей/раскраски во время поворота листа.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { cdp, findChrome, sleep, waitFor } from './check-motion.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMIC = process.argv[2] ?? 'intro';
const THROTTLE = Number(process.env.THROTTLE ?? 4);

// Довести текущую страницу до конца: все кадры проявлены
const REVEAL = `(async () => {
  const cur = () => [...document.querySelectorAll('.cx-book .cx-page')].at(-1);
  for (let i = 0; i < 8 && cur().querySelector('.cx-panel:not(.is-in)'); i++) {
    document.querySelector('.cx-next').click();
    await new Promise((r) => setTimeout(r, 700));
  }
  return !cur().querySelector('.cx-panel:not(.is-in)');
})()`;

// Перевернуть лист и записать кадры поворота
const TURN = `(async () => {
  const frames = [];
  let turned = false;
  document.addEventListener('comic:turn', () => { turned = true; }, { once: true });
  document.querySelector('.cx-next').click();
  if (!turned) return null;
  let last = performance.now();
  const end = last + 900;
  await new Promise((done) => {
    const tick = (t) => { frames.push(t - last); last = t; if (t < end) requestAnimationFrame(tick); else done(); };
    requestAnimationFrame(tick);
  });
  const n = frames.length;
  return { fps: +(n / 0.9).toFixed(1), long: frames.filter((d) => d > 34).length, worst: Math.round(Math.max(...frames)) };
})()`;

async function metrics(client) {
  const { metrics } = await client.send('Performance.getMetrics');
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
}

async function run() {
  const server = await createServer({
    root,
    configFile: path.join(root, 'vite.config.mts'),
    logLevel: 'error',
    server: { port: 5194, strictPort: false, host: '127.0.0.1' },
  });
  await server.listen();
  const base = server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5194/';
  const profile = path.join(root, 'node_modules', '.cache', 'comic-probe');
  fs.rmSync(profile, { recursive: true, force: true });
  fs.mkdirSync(profile, { recursive: true });
  const chrome = spawn(
    findChrome(),
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--mute-audio',
      ...(process.env.SOFT ? ['--disable-gpu'] : ['--enable-gpu-rasterization']),
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  let client;
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    const port = await waitFor(
      () => fs.existsSync(portFile) && fs.readFileSync(portFile, 'utf8').split('\n')[0],
      15000,
      'Chrome',
    );
    const pages = await waitFor(
      async () => {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        return list.filter((t) => t.type === 'page').length ? list : null;
      },
      10000,
      'вкладка',
    );
    client = cdp(pages.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await client.opened;
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Performance.enable');
    await client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2.75, mobile: true });
    await client.send('Page.navigate', { url: `${base}?comic=${COMIC}` });
    await waitFor(() => client.eval('!!document.querySelector(".cx-book .cx-page")'), 30000, 'комикс');
    if (process.env.EXTRA)
      await client.eval(
        `(() => { document.head.append(Object.assign(document.createElement('style'), { textContent: ${JSON.stringify(process.env.EXTRA)} })); return 1; })()`,
      );
    const total = await client.eval('document.querySelectorAll(".cx-dots > *").length || 7');
    await sleep(1500);
    for (let p = 1; p < total; p++) {
      await client.eval(REVEAL);
      await sleep(4000);
      await client.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
      const a = await metrics(client);
      const r = process.env.IDLE ? await client.eval(TURN.replace("document.querySelector('.cx-next').click();", "turned = true;")) : await client.eval(TURN);
      const b = await metrics(client);
      await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      const per = (k) => Math.round((b[k] - a[k]) * 1000);
      if (!r) {
        console.log(`${p}→${p + 1}: лист не перевернулся`);
        break;
      }
      console.log(
        `${p}→${p + 1}: fps ${String(r.fps).padStart(5)}  долгих ${String(r.long).padStart(2)}  худший ${String(r.worst).padStart(4)} мс | стиль ${per('RecalcStyleDuration')} мс, вёрстка ${per('LayoutDuration')} мс, скрипт ${per('ScriptDuration')} мс, задачи ${per('TaskDuration')} мс`,
      );
    }
  } finally {
    client?.close();
    chrome.kill();
    await server.close();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
