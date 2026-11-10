// Плавность окна комнаты на эмуляции телефона 390×844, плотность 2,75, процессор замедлен (THROTTLE, 4):
// наезд камеры на слот, полёт карточки и подъём фасада при открытии, обратный путь при закрытии.
// Запуск: npm run perf:room. Печатает fps, долгие кадры, худший кадр и время стилей, вёрстки, раскраски.
// EXTRA='<css>' — свой вариант стиля поверх, SETUP='<js>' — выполнить на странице перед замером, ROOM=ярус:слот — какую комнату открыть, SHOT=<файл.png> — снимок открытой комнаты.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { cdp, findChrome, sleep, waitFor } from './check-motion.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THROTTLE = Number(process.env.THROTTLE ?? 4);
const RUNS = Number(process.env.RUNS ?? 3);

/** Кадры за ms после действия: длительности rAF. */
const record = (action, ms) => `(async () => {
  const frames = [];
  let last = performance.now();
  const end = last + ${ms};
  const p = new Promise((done) => {
    const tick = (t) => { frames.push(t - last); last = t; if (t < end) requestAnimationFrame(tick); else done(); };
    requestAnimationFrame(tick);
  });
  ${action};
  await p;
  const n = frames.length;
  return { first: frames.slice(0, 10).map(Math.round), fps: +(n / (${ms} / 1000)).toFixed(1), long: frames.filter((d) => d > 34).length, worst: Math.round(Math.max(...frames)) };
})()`;

async function metrics(client, cpu) {
  const { metrics } = await client.send('Performance.getMetrics');
  return { ...Object.fromEntries(metrics.map((m) => [m.name, m.value])), cpu: await cpu() };
}

async function run() {
  const server = await createServer({
    root,
    configFile: path.join(root, 'vite.config.mts'),
    logLevel: 'error',
    server: { port: 5195, strictPort: false, host: '127.0.0.1' },
  });
  await server.listen();
  const base = server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5195/';
  const profile = path.join(root, 'node_modules', '.cache', 'room-probe');
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
    // Процессорное время по процессам: рендерер — стили, раскраска; GPU — растр и компоновка
    const browser = cdp((await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl);
    await browser.opened;
    const cpu = async () => {
      const { processInfo } = await browser.send('SystemInfo.getProcessInfo');
      const by = {};
      for (const p of processInfo) by[p.type] = (by[p.type] ?? 0) + p.cpuTime;
      return by;
    };
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Performance.enable');
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2.75,
      mobile: true,
    });
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await client.send('Page.navigate', { url: `${base}?tutorial=end_day` });
    await waitFor(() => client.eval('window.sedmaya?.loop?.phase === "day"'), 30000, 'день');
    if (process.env.EXTRA)
      await client.eval(
        `(() => { document.head.append(Object.assign(document.createElement('style'), { textContent: ${JSON.stringify(process.env.EXTRA)} })); return 1; })()`,
      );
    if (process.env.SETUP) await client.eval(process.env.SETUP);
    // Комната: из ROOM или первый занятый слот
    const where = process.env.ROOM
      ? process.env.ROOM.split(':').map(Number)
      : await client.eval(
          `(() => { const t = sedmaya.store.state.tiers; for (let i = 0; i < t.length; i++) { const j = t[i].slots.findIndex(Boolean); if (j >= 0) return [i, j]; } return [0, 0]; })()`,
        );
    console.log(`комната ${where.join(':')}, замедление ×${THROTTLE}`);
    await sleep(2000);
    await client.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
    const per = (a, b, k, ms) => Math.round(((b[k] - a[k]) / ms) * 1e6);
    const line = (name, r, a, b, ms) =>
      console.log(
        `${name.padEnd(8)} fps ${String(r.fps).padStart(5)}  долгих ${String(r.long).padStart(2)}  худший ${String(r.worst).padStart(4)} мс | на секунду: рендерер ${Math.round((((b.cpu.renderer ?? 0) - (a.cpu.renderer ?? 0)) / ms) * 1e6)} мс, GPU ${Math.round((((b.cpu.GPU ?? 0) - (a.cpu.GPU ?? 0)) / ms) * 1e6)} мс, стиль ${per(a, b, 'RecalcStyleDuration', ms)} мс, вёрстка ${per(a, b, 'LayoutDuration', ms)} мс, скрипт ${per(a, b, 'ScriptDuration', ms)} мс`,
      );
    for (let i = 0; i < RUNS; i++) {
      let a = await metrics(client, cpu);
      let r = await client.eval(record(`sedmaya.room.open(${where[0]}, ${where[1]})`, 1200));
      let b = await metrics(client, cpu);
      line('открытие', r, a, b, 1200);
      if (process.env.FRAMES) console.log('  первые кадры', r.first.join(' '));
      a = await metrics(client, cpu);
      r = await client.eval(record('1', 1000));
      b = await metrics(client, cpu);
      line('открыто', r, a, b, 1000);
      // Камера доехала: слой will-change снят, башня перерисована чётко (TowerScene.setMovingLayer)
      const layer = await client.eval('document.querySelector(".tw-game").style.willChange');
      if (layer) throw new Error(`камера стоит, а у башни осталось will-change: ${layer}`);
      if (process.env.SHOT && i === 0) {
        const { data } = await client.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(process.env.SHOT, Buffer.from(data, 'base64'));
      }
      a = await metrics(client, cpu);
      r = await client.eval(record('sedmaya.room.close()', 1000));
      b = await metrics(client, cpu);
      line('закрытие', r, a, b, 1000);
      await sleep(800);
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
