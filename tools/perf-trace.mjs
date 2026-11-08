// Какие CSS-анимации не уходят на видеокарту и почему: трасса Chrome (blink.animations), события
// Animation с compositeFailed. Запуск: node tools/perf-trace.mjs [url-параметры], по умолчанию ?preset=good.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { findChrome, sleep, waitFor } from './check-motion.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUERY = process.argv[2] ?? '?preset=good';

// Биты blink CompositorAnimations::FailureReason
const REASONS = [
  'AcceleratedAnimationsDisabled',
  'EffectSuppressedByDevtools',
  'InvalidAnimationOrEffect',
  'UnsupportedTimingParameters',
  'NonReplaceCompositeMode',
  'TargetHasInvalidCompositingState',
  'TargetHasIncompatibleAnimations',
  'TargetHasCSSOffset',
  'TargetHasMultipleTransformProperties',
  'AffectsNonCSSProperties',
  'TransformCannotBeAcceleratedOnTarget',
  'FilterMayMovePixels',
  'UnsupportedCSSProperty',
  'MixedKeyframeValueTypes',
  'TimelineSourceInvalid',
  'NoVisibleChange',
  'AffectsImportantProperty',
  'SVGTargetHasIndependentTransform',
];

/** DevTools-протокол с подпиской на события. */
export function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const wait = new Map();
  const listeners = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(String(e.data));
    if (m.method) for (const l of listeners) l(m);
    const w = m.id && wait.get(m.id);
    if (!w) return;
    wait.delete(m.id);
    if (m.error) w.reject(new Error(m.error.message));
    else w.resolve(m.result);
  });
  return {
    opened: new Promise((ok) => ws.addEventListener('open', ok, { once: true })),
    on: (l) => listeners.push(l),
    send(method, params = {}) {
      const n = ++id;
      ws.send(JSON.stringify({ id: n, method, params }));
      return new Promise((resolve, reject) => wait.set(n, { resolve, reject }));
    },
    async eval(expression) {
      const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      return r.result.value;
    },
    close: () => ws.close(),
  };
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
  const profile = path.join(root, 'node_modules', '.cache', 'perf-trace');
  fs.rmSync(profile, { recursive: true, force: true });
  fs.mkdirSync(profile, { recursive: true });
  const chrome = spawn(
    findChrome(),
    ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'],
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
    client = connect(pages.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await client.opened;
    const events = [];
    let done;
    const finished = new Promise((r) => {
      done = r;
    });
    client.on((m) => {
      if (m.method === 'Tracing.dataCollected') events.push(...m.params.value);
      if (m.method === 'Tracing.tracingComplete') done();
    });
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2.75,
      mobile: true,
    });
    await client.send('Tracing.start', {
      traceConfig: { includedCategories: ['blink.animations'] },
      transferMode: 'ReportEvents',
    });
    await client.send('Page.navigate', { url: `${base}${QUERY}` });
    await waitFor(() => client.eval('!!document.querySelector(".tw")'), 30000, 'башня');
    if (process.env.SETUP) await client.eval(process.env.SETUP);
    await sleep(3000);
    const names = await client.eval(
      `JSON.stringify(document.getAnimations().map((a) => [a.animationName, a.effect?.target?.className?.toString?.() ?? '']))`,
    );
    await client.send('Tracing.end');
    await Promise.race([finished, sleep(20000)]);
    const failed = new Map();
    for (const e of events) {
      const d = e.args?.data;
      if (e.name !== 'Animation' || !d || d.compositeFailed == null) continue;
      const r = REASONS.filter((_, i) => d.compositeFailed & (1 << i));
      const key = `${r.join('+')}${d.unsupportedProperties?.length ? ` [${d.unsupportedProperties.join(',')}]` : ''}`;
      if (!failed.has(key)) failed.set(key, new Set());
      failed.get(key).add(d.name ?? e.id2?.local ?? e.id);
    }
    for (const [r, set] of failed) console.log(`${r}: ${set.size} — ${[...set].slice(0, 30).join(', ')}`);
    const list = JSON.parse(names);
    console.log(`анимаций на странице: ${list.length}`);
    const count = {};
    for (const [n, c] of list) count[`${n} @ ${c}`] = (count[`${n} @ ${c}`] ?? 0) + 1;
    if (process.env.LIST) for (const [k, v] of Object.entries(count)) console.log(`  ${v}× ${k}`);
  } finally {
    client?.close();
    chrome.kill();
    await server.close();
  }
}

if (process.argv[1]?.endsWith("perf-trace.mjs")) run().catch((e) => {
  console.error(e);
  process.exit(1);
});
