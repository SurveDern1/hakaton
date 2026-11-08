// Проверка окна события на низких экранах: тело окна прокручивается, последний вариант достаётся
// прокруткой и целиком попадает в экран; реплика после выбора держится не меньше 5 с.
// Запуск: npm run check:scroll (нужен Chrome или Edge; путь можно задать в CHROME).
// SCROLL_SHOTS=<папка> — снимок окна, докрученного до низа, на каждом размере.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { cdp, findChrome, sleep, waitFor } from './check-motion.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVENT = process.env.SCROLL_EVENT || 'd02_raft';
const VIEWPORTS = [
  { name: 'телефон 360×640', width: 360, height: 640, mobile: true },
  { name: 'телефон 412×700', width: 412, height: 700, mobile: true },
  { name: 'телефон 390×844', width: 390, height: 844, mobile: true },
  { name: 'ноутбук 1366×600', width: 1366, height: 600, mobile: false },
];

async function run() {
  const server = await createServer({
    root,
    configFile: path.join(root, 'vite.config.mts'),
    logLevel: 'error',
    server: { port: 5192, strictPort: false, host: '127.0.0.1' },
  });
  await server.listen();
  const base = server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5192/';
  const profile = path.join(root, 'node_modules', '.cache', 'check-scroll');
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
      await client.send('Page.navigate', { url: `${base}?event=${EVENT}` });
      await waitFor(() => client.eval(`!!document.querySelector('.ev-choice')`), 30000, `окно ${vp.name}`);
      await sleep(400);
      // Докрутить тело окна до низа и проверить, что последний вариант целиком в экране
      const r = await client.eval(`(() => {
        const body = document.querySelector('.ev-body');
        body.scrollTop = body.scrollHeight;
        const last = [...document.querySelectorAll('.ev-choice')].pop().getBoundingClientRect();
        const b = body.getBoundingClientRect();
        return { scrollH: body.scrollHeight, clientH: body.clientHeight, top: body.scrollTop,
          lastBottom: Math.round(last.bottom), bodyBottom: Math.round(b.bottom), vh: innerHeight };
      })()`);
      const ok = r.lastBottom <= Math.min(r.bodyBottom, r.vh) + 1;
      if (!ok) failed++;
      console.log(`${ok ? 'OK  ' : 'FAIL'} ${vp.name}: тело ${r.clientH} из ${r.scrollH}, низ варианта ${r.lastBottom}, низ окна ${r.bodyBottom}, экран ${r.vh}`);
      const shots = process.env.SCROLL_SHOTS;
      if (shots) {
        const shot = await client.send('Page.captureScreenshot', { format: 'png' });
        fs.mkdirSync(shots, { recursive: true });
        fs.writeFileSync(path.join(shots, `event-${vp.width}x${vp.height}.png`), Buffer.from(shot.data, 'base64'));
      }
    }

    // Реплика после выбора: держится не меньше 5 с и уходит сама
    const vp = VIEWPORTS[0];
    await client.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: true });
    await client.send('Page.navigate', { url: `${base}?event=${EVENT}` });
    await waitFor(() => client.eval(`!!document.querySelector('.ev-choice')`), 30000, 'окно для реплики');
    await sleep(400);
    await client.eval(`document.querySelector('.ev-choice:not([aria-disabled="true"])').click()`);
    const t0 = Date.now();
    await waitFor(() => client.eval(`!!document.querySelector('.ev-reply')`), 5000, 'реплика');
    const shown = Date.now() - t0;
    await waitFor(() => client.eval(`!document.querySelector('.ev-reply')`), 15000, 'уход реплики');
    const held = Date.now() - t0 - shown;
    const ok = held >= 5000;
    if (!ok) failed++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} реплика держалась ${(held / 1000).toFixed(1)} с`);
  } finally {
    client?.close?.();
    chrome.kill();
    await server.close();
  }
  if (failed) process.exitCode = 1;
}

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
