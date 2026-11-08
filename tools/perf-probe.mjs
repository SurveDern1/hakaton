// Замер плавности башни на эмуляции телефона: headless Chrome, 390×844, DPR 2.75, CPU замедлен.
// Запуск: node tools/perf-probe.mjs [url-параметры]. Печатает fps, долю долгих кадров и время
// стилей/вёрстки/скриптов на секунду для базового вида и для вариантов с отключёнными эффектами.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { cdp, findChrome, sleep, waitFor } from './check-motion.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUERY = process.argv[2] ?? '?preset=good';
const THROTTLE = Number(process.env.THROTTLE ?? 4);
const SECONDS = Number(process.env.SECONDS ?? 5);

/** Отменить анимации, в кадрах которых есть одно из свойств. */
const stop = (props) =>
  `(() => { let n = 0; for (const a of document.getAnimations()) { const k = a.effect?.getKeyframes?.() ?? []; if (k.some((f) => ${JSON.stringify(props)}.some((p) => p in f))) { a.cancel(); n++; } } return n; })()`;

/** Добавить стиль на страницу. */
const css = (text) =>
  `(() => { document.head.append(Object.assign(document.createElement('style'), { textContent: ${JSON.stringify(text)} })); return '-'; })()`;

const VARIANTS = {
  base: '',
  stopBgPos: stop(['backgroundPosition', 'backgroundPositionX', 'backgroundPositionY']),
  stopFilter: stop(['filter']),
  stopTransform: stop(['transform', 'translate', 'scale', 'rotate', 'opacity']),
  noGrain: css('#app::after{display:none!important}'),
  grainNormal: css('#app::after{mix-blend-mode:normal!important;opacity:.07!important}'),
  noTowerAnim: css('.tw *{animation:none!important}'),
  noClouds: css('.tw .cloud,.tw .cl,.tw .streak{display:none!important}'),
  staticMist: css('.tw .mist{animation:none!important}'),
  noBlend: css('.tw *{mix-blend-mode:normal!important}'),
  // Кандидат облегчённого режима: всё вместе
  lite: css(
    `#app::after{mix-blend-mode:normal!important;opacity:.07!important}
     .tw *{mix-blend-mode:normal!important}
     .tw .mist{animation:none!important}`,
  ),
  noAnimAtAll: css('*,*::before,*::after{animation:none!important}'),
};
if (process.env.EXTRA) VARIANTS.extra = css(process.env.EXTRA);

const MEASURE = `(async () => {
  const frames = [];
  let last = performance.now();
  const end = last + ${SECONDS * 1000};
  await new Promise((done) => {
    const tick = (t) => { frames.push(t - last); last = t; if (t < end) requestAnimationFrame(tick); else done(); };
    requestAnimationFrame(tick);
  });
  const n = frames.length;
  const long = frames.filter((d) => d > 34).length;
  return { fps: +(n / ${SECONDS}).toFixed(1), long, worst: Math.round(Math.max(...frames)) };
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
    server: { port: 5193, strictPort: false, host: '127.0.0.1' },
  });
  await server.listen();
  const base = server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5193/';
  const profile = path.join(root, 'node_modules', '.cache', 'perf-probe');
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
    // Браузерное соединение: процессорное время по процессам (рендерер — стили и раскраска,
    // GPU — компоновка слоёв; без видеокарты это прямая цена перерисовки)
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
    const only = process.env.VARIANTS?.split(',');
    for (const [name, inject] of Object.entries(VARIANTS)) {
      if (only && !only.includes(name)) continue;
      await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      await client.send('Page.navigate', { url: `${base}${QUERY}` });
      await waitFor(() => client.eval('!!document.querySelector(".tw")'), 30000, 'башня');
      if (process.env.SETUP) await client.eval(process.env.SETUP);
      const cancelled = inject ? await client.eval(inject) : 0;
      await sleep(2500);
      await client.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
      const a = await metrics(client);
      const c0 = await cpu();
      const r = await client.eval(MEASURE);
      const b = await metrics(client);
      const c1 = await cpu();
      const cpuPer = (k) => Math.round((((c1[k] ?? 0) - (c0[k] ?? 0)) / SECONDS) * 1000);
      const per = (k) => Math.round(((b[k] - a[k]) / SECONDS) * 1000);
      const parts = await client.eval('document.querySelectorAll(".tw *").length');
      console.log(
        `${name.padEnd(12)} fps ${String(r.fps).padStart(5)}  долгих ${String(r.long).padStart(3)}  худший ${String(r.worst).padStart(4)} мс | ЦП на секунду: рендерер ${cpuPer('renderer')} мс, GPU ${cpuPer('GPU')} мс | стиль ${per('RecalcStyleDuration')} мс, вёрстка ${per('LayoutDuration')} мс, скрипт ${per('ScriptDuration')} мс, задачи ${per('TaskDuration')} мс | деталей ${parts}, анимаций ${await client.eval('document.getAnimations().length')}, снято ${cancelled ?? '-'}`,
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
