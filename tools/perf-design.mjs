// Замер холста макетов: все экраны design/project сразу, как на холсте Claude Design (каждый в своём
// iframe, раскладка из canvas.json, общий вид целиком в окне 1600×1000). Печатает fps, долгие кадры,
// процессорное время рендерера и GPU на секунду и число идущих анимаций — для холста целиком и по экранам.
// Запуск: npm run perf:design [-- Main,Tower]   (без аргумента — весь холст и каждый экран отдельно)
// Переменные: THROTTLE=4 — замедление процессора, SECONDS=4, VARIANTS=base,hover,noAnim, SOFT=1 — без видеокарты.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cdp, findChrome, sleep, waitFor } from './check-motion.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'node_modules', '.cache', 'perf-design');
const THROTTLE = Number(process.env.THROTTLE ?? 1);
const SECONDS = Number(process.env.SECONDS ?? 4);
const VIEW = { width: 1600, height: 1000 };

// Варианты: стиль, который добавляется в каждый экран перед замером
const VARIANTS = {
  base: '',
  // Указатель над экраном: на холсте с паузой анимации идут только у него
  hover: 'hover',
  noAnim: '*,*::before,*::after{animation:none!important}',
  noGrain: '.sd::after,.grain::after{display:none!important}',
};

const canvas = JSON.parse(fs.readFileSync(path.join(root, 'design', 'project', 'canvas.json'), 'utf8'));

/** Страница-холст: экраны в iframe по раскладке canvas.json, общий вид вписан в окно. */
function canvasPage(only) {
  const boards = Object.entries(canvas.boards)
    .filter(([f]) => !only || only.includes(f.replace('.dc.html', '')))
    .map(([f, b]) => ({ ...b, src: f.replace('.dc.html', '.html') }));
  const x0 = Math.min(...boards.map((b) => b.x));
  const y0 = Math.min(...boards.map((b) => b.y));
  const w = Math.max(...boards.map((b) => b.x + b.w)) - x0;
  const h = Math.max(...boards.map((b) => b.y + b.h)) - y0;
  const k = Math.min(VIEW.width / w, VIEW.height / h);
  const frames = boards
    .map(
      (b) =>
        `<iframe src="${b.src}" scrolling="no" style="left:${b.x - x0}px;top:${b.y - y0}px;width:${b.w}px;height:${b.h}px"></iframe>`,
    )
    .join('\n');
  return `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:#1d1d1f;overflow:hidden}
#c{position:absolute;left:0;top:0;width:${w}px;height:${h}px;transform:scale(${k});transform-origin:0 0}
iframe{position:absolute;border:0;background:#0b1a1d}
</style><div id="c">${frames}</div>`;
}

function serve(dir) {
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(dir, url === '/' ? 'index.html' : url);
    if (!file.startsWith(dir) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

const MEASURE = `(async () => {
  const frames = [];
  let last = performance.now();
  const end = last + ${SECONDS * 1000};
  await new Promise((done) => {
    const tick = (t) => { frames.push(t - last); last = t; if (t < end) requestAnimationFrame(tick); else done(); };
    requestAnimationFrame(tick);
  });
  return { fps: +(frames.length / ${SECONDS}).toFixed(1), long: frames.filter((d) => d > 34).length, worst: Math.round(Math.max(...frames)) };
})()`;

/** Сколько анимаций идёт во всех экранах (на паузе не считаются). */
const RUNNING = `(() => {
  const run = [...document.querySelectorAll('iframe')].flatMap((f) => f.contentDocument.getAnimations().filter((a) => a.playState === 'running').map((a) => f.src.split('/').pop().replace('.html', '') + ':' + (a.animationName ?? '?') + ' .' + String(a.effect?.target?.className ?? '').replace(/ +/g, '.')));
  return run.length + (run.length && run.length <= 5 ? ' — ' + run.join(', ') : '');
})()`;

const inject = (style) =>
  style === 'hover'
    ? `(() => { const f = document.querySelector('iframe'); f.contentDocument.querySelector('.sd, .tw').classList.add('is-live'); return f.src.split('/').pop(); })()`
    : `(() => { for (const f of document.querySelectorAll('iframe')) f.contentDocument.head.append(Object.assign(f.contentDocument.createElement('style'), { textContent: ${JSON.stringify(style)} })); return '-'; })()`;

async function run() {
  fs.rmSync(out, { recursive: true, force: true });
  execFileSync(process.execPath, [path.join(root, 'tools', 'export-design.js'), out], { stdio: 'ignore' });
  const only = process.argv[2]?.split(',');
  const sets = only
    ? [['выбранные', only]]
    : [['холст', null], ...Object.keys(canvas.boards).map((f) => [f.replace('.dc.html', ''), [f.replace('.dc.html', '')]])];
  sets.forEach(([name, list], i) => {
    fs.writeFileSync(path.join(out, `perf-${i}.html`), canvasPage(list));
  });
  const server = await serve(out);
  const base = `http://127.0.0.1:${server.address().port}/`;
  const profile = path.join(root, 'node_modules', '.cache', 'perf-design-profile');
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
    await client.send('Emulation.setDeviceMetricsOverride', { ...VIEW, deviceScaleFactor: 1, mobile: false });
    const variants = process.env.VARIANTS?.split(',') ?? Object.keys(VARIANTS);
    for (const [i, [name]] of sets.entries()) {
      for (const v of variants) {
        if (v === 'hover' && name !== 'холст') continue;
        await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
        await client.send('Page.navigate', { url: `${base}perf-${i}.html` });
        await waitFor(
          () =>
            client.eval(
              `[...document.querySelectorAll('iframe')].every((f) => f.contentDocument?.readyState === 'complete' && f.contentDocument.querySelector('.tw, .sd'))`,
            ),
          60000,
          'экраны',
        );
        const note = VARIANTS[v] ? await client.eval(inject(VARIANTS[v])) : '';
        await sleep(2000);
        await client.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
        const c0 = await cpu();
        const r = await client.eval(MEASURE);
        const c1 = await cpu();
        const per = (k) => Math.round((((c1[k] ?? 0) - (c0[k] ?? 0)) / SECONDS) * 1000);
        console.log(
          `${name.padEnd(10)} ${v.padEnd(7)} fps ${String(r.fps).padStart(5)}  долгих ${String(r.long).padStart(3)}  худший ${String(r.worst).padStart(5)} мс | ЦП на секунду: рендерер ${String(per('renderer')).padStart(4)} мс, GPU ${String(per('GPU')).padStart(4)} мс | анимаций идёт ${await client.eval(RUNNING)}${v === 'hover' ? ` (наведён ${note})` : ''}`,
        );
      }
    }
  } finally {
    client?.close();
    chrome.kill();
    server.close();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
