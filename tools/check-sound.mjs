// Проверка звука без колонок: npm run check:sound (нужен Chrome или Edge; путь можно задать в CHROME).
// Поднимает dev-сервер Vite и headless Chrome с политикой автозапуска «только после жеста»:
//   1. игра 3 с без жеста — AudioContext не создан, sedmaya.sound.engine.played пуст;
//   2. клик мышью через DevTools — контекст запущен (running);
//   3. клавиша M — общая громкость в 0 за 0,3 с, повтор — обратно;
//   4. ?event=d02_raft и день: фон запущен, окно события его приглушает, режим «набор» поднимает тон;
//   5. ?sound=lab → sedmaya.sound.lab.measure(): рендер каждого звука, темы и сцены фона на OfflineAudioContext,
//      таблица метрик (src/audio/metrics.ts) и пороги (LIMITS: пик, сумма после ограничителя, щелчок
//      на краях, хвост тишины); громкость сверяется с базовой линией tools/sound-baseline.json (±1 LU).
// Код выхода 1 при нарушении. SOUND_WAV=<папка> — заодно WAV каждого звука для прослушивания.
// --update-baseline — записать текущие громкости как базовую линию (после намеренной правки звука).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { cdp, findChrome, sleep, waitFor } from './check-motion.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(root, 'tools', 'sound-baseline.json');
/** Допуск громкости против базовой линии, LU. */
const LU_TOLERANCE = 1;
/** Ожидание без жеста, мс. */
const SILENT_MS = 3000;
/** «Без звука» должен сработать за это время, мс. */
const MUTE_MS = 300;

const fmt = (v, d = 1) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : '−∞');

/** Сверка громкости с базовой линией: список расхождений больше допуска. */
export function compareBaseline(rows, baseline) {
  const errs = [];
  for (const r of rows) {
    const was = baseline[r.id];
    if (typeof was !== 'number') continue;
    const now = Number.isFinite(r.lufs) ? r.lufs : -Infinity;
    if (!(Math.abs(now - was) <= LU_TOLERANCE))
      errs.push(`${r.id}: громкость ${fmt(now)} LUFS, базовая линия ${fmt(was)} (допуск ±${LU_TOLERANCE} LU)`);
  }
  return errs;
}

function table(rows, baseline) {
  const head = ['звук', 'пик', 'огр.', 'LUFS', 'база', 'край', 'хвост', '>150Гц', 'корр', 'длина'];
  const lines = rows.map((r) => [
    r.id,
    fmt(r.peak),
    fmt(r.peakPost),
    fmt(r.lufs),
    typeof baseline[r.id] === 'number' ? fmt(baseline[r.id]) : 'нов.',
    fmt(r.edge, 0),
    fmt(r.tail, 0),
    `${Math.round(r.high * 100)}%`,
    fmt(r.corr, 2),
    `${fmt(r.length, 2)}с`,
  ]);
  const all = [head, ...lines];
  const w = head.map((_, i) => Math.max(...all.map((l) => String(l[i]).length)));
  return all.map((l) => l.map((c, i) => (i ? String(c).padStart(w[i]) : String(c).padEnd(w[i]))).join('  ')).join('\n');
}

async function run() {
  const update = process.argv.includes('--update-baseline');
  const server = await createServer({
    root,
    configFile: path.join(root, 'vite.config.mts'),
    logLevel: 'error',
    server: { port: 5192, strictPort: false, host: '127.0.0.1' },
  });
  await server.listen();
  const base = server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5192/';

  const profile = path.join(root, 'node_modules', '.cache', 'check-sound');
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
      '--autoplay-policy=user-gesture-required',
      ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  const errors = [];
  const step = (ok, text) => {
    console.log(`${ok ? 'ок ' : 'НЕТ'} ${text}`);
    if (!ok) errors.push(text);
  };
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
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    // Счётчик созданных AudioContext: до жеста их быть не должно вовсе, не только у движка
    await client.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        window.__audioContexts = 0;
        const C = window.AudioContext;
        if (C) window.AudioContext = class extends C {
          constructor(...a) { super(...a); window.__audioContexts += 1; }
        };
      })();`,
    });

    // 1. Без жеста — тишина
    await client.send('Page.navigate', { url: base });
    await waitFor(() => client.eval('!!window.sedmaya?.sound?.engine'), 30000, 'игра загрузилась');
    await sleep(SILENT_MS);
    const silent = await client.eval(`({
      ctx: window.sedmaya.sound.engine.ctx === null,
      made: window.__audioContexts,
      played: window.sedmaya.sound.engine.played.length,
    })`);
    step(
      silent.ctx && silent.made === 0 && silent.played === 0,
      `без жеста ${SILENT_MS / 1000} с: контекстов ${silent.made}, сыграно звуков ${silent.played}`,
    );

    // 2. Клик мышью (вне кнопок: по полю слева от рамки игры) — контекст запущен
    for (const type of ['mousePressed', 'mouseReleased'])
      await client.send('Input.dispatchMouseEvent', { type, x: 8, y: 450, button: 'left', clickCount: 1 });
    const running = await waitFor(
      () => client.eval('window.sedmaya.sound.engine.ctx?.state === "running"'),
      5000,
      'контекст после клика',
    ).catch(() => false);
    step(running, 'после клика AudioContext запущен (running)');

    // 3. M — «Без звука» за 0,3 с и обратно
    const pressM = async () => {
      await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'm', code: 'KeyM', text: 'm' });
      await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'm', code: 'KeyM' });
      return client.eval(
        `new Promise((ok) => setTimeout(() => ok(window.sedmaya.sound.engine.master.gain.value), ${MUTE_MS}))`,
      );
    };
    if (running) {
      const off = await pressM();
      step(off <= 0.001, `M: общая громкость ${fmt(off, 3)} через ${MUTE_MS} мс (нужно 0)`);
      const on = await pressM();
      const want = await client.eval('window.sedmaya.sound.engine.levels().master');
      step(Math.abs(on - want) < 0.01 && want > 0, `M ещё раз: громкость ${fmt(on, 3)} (нужно ${fmt(want, 3)})`);
    }

    // 4. Фон в игре: окно события приглушает атмосферу, днём слышен двигатель, режим меняет его тон
    await client.send('Page.navigate', { url: `${base}?event=d02_raft` });
    await waitFor(() => client.eval('!!document.querySelector(".ev-layer")'), 30000, 'окно события');
    for (const type of ['mousePressed', 'mouseReleased'])
      await client.send('Input.dispatchMouseEvent', { type, x: 8, y: 450, button: 'left', clickCount: 1 });
    await sleep(2000);
    const amb = await client.eval(`({
      started: window.sedmaya.sound.ambience.started,
      wind: window.sedmaya.sound.ambience.readout()?.wind ?? 0,
      duck: window.sedmaya.sound.engine.ducking('amb'),
    })`);
    step(amb.started && amb.wind > 0.01, `фон запущен после жеста, ветер ${fmt(amb.wind, 3)}`);
    step(
      amb.duck.count >= 1 && amb.duck.gain < 0.6,
      `окно события приглушает фон: приглушений ${amb.duck.count}, множитель ${fmt(amb.duck.gain, 2)}`,
    );
    await client.eval('window.sedmaya.loop.continueGame({ ...window.sedmaya.store.state, engineMode: "hold" })');
    await sleep(2500);
    const hold = await client.eval('window.sedmaya.sound.ambience.readout()');
    step(hold.engine > 0.01 && Math.abs(hold.f0 - 46) < 2, `днём двигатель: громкость ${fmt(hold.engine, 3)}, тон ${fmt(hold.f0)} Гц`);
    await client.eval('window.sedmaya.store.dispatch((s) => ({ ...s, engineMode: "climb" }))');
    await sleep(1500);
    const climb = await client.eval('window.sedmaya.sound.ambience.readout()');
    step(
      climb.f0 > 54 && climb.cutoff > hold.cutoff,
      `«Набирать высоту»: тон ${fmt(hold.f0)} → ${fmt(climb.f0)} Гц, срез ${fmt(hold.cutoff, 0)} → ${fmt(climb.cutoff, 0)} Гц за 1,5 с`,
    );

    // 5. Лаборатория: рендер и метрики
    await client.send('Page.navigate', { url: `${base}?sound=lab` });
    await waitFor(() => client.eval('!!window.sedmaya?.sound?.lab'), 30000, 'лаборатория ?sound=lab');
    const rows = await client.eval('window.sedmaya.sound.lab.measure()');
    const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};
    console.log(`\nМетрики по рендеру (${rows.length} звуков; пик — сумма шин, огр. — после ограничителя):`);
    console.log(table(rows, baseline));
    for (const r of rows) for (const e of r.errors) step(false, `${r.id}: ${e}`);
    if (update) {
      const next = Object.fromEntries(rows.map((r) => [r.id, Number(r.lufs.toFixed(2))]));
      fs.writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
      console.log(`Базовая линия записана: ${path.relative(root, BASELINE)}`);
    } else {
      for (const e of compareBaseline(rows, baseline)) step(false, e);
      const fresh = rows.filter((r) => typeof baseline[r.id] !== 'number').map((r) => r.id);
      if (fresh.length) console.log(`Нет в базовой линии (запишется --update-baseline): ${fresh.join(', ')}`);
    }

    const wavDir = process.env.SOUND_WAV;
    if (wavDir) {
      fs.mkdirSync(wavDir, { recursive: true });
      for (const r of rows) {
        const b64 = await client.eval(`window.sedmaya.sound.lab.wav(${JSON.stringify(r.id)})`);
        fs.writeFileSync(path.join(wavDir, `${r.id.replace(/[^a-z0-9@-]+/gi, '_')}.wav`), Buffer.from(b64, 'base64'));
      }
      console.log(`WAV: ${rows.length} файлов в ${wavDir}`);
    }
  } finally {
    client?.close();
    chrome.kill();
    await server.close();
  }
  if (errors.length) {
    console.error(`\nЗвук: ${errors.length} нарушений`);
    process.exit(1);
  }
  console.log('\nЗвук: тишина до жеста, выключатель и все звуки в порогах');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  });
}
