// Проверка звука без колонок: npm run check:sound (нужен Chrome или Edge; путь можно задать в CHROME).
// Поднимает dev-сервер Vite и headless Chrome с политикой автозапуска «только после жеста»:
//   1. игра 3 с без жеста — заставка «Включить радио», AudioContext не создан, played пуст;
//   2. клик мышью по «Включить радио» — контекст запущен (running), заставка уходит плавно (сэмплы
//      прозрачности), ветер, радио, на «Всем! Всем! Всем!» три вспышки по классу is-on-air (сэмплы
//      прозрачности надписи), после фразы — мелодия дня;
//   3. клавиша M — общая громкость в 0 за 0,3 с, повтор — обратно;
//   4. ?event=d02_raft и день: фон запущен, окно события его приглушает, режим «набор» поднимает тон;
//      ?event=d06_signal — радио в окне «Сигнал», музыка −10 дБ; ?comic=outro_harbor — помехи у облачка рации;
//   5. ?sound=lab → sedmaya.sound.lab.measure(): рендер каждого звука, темы и сцены фона на OfflineAudioContext,
//      таблица метрик (src/audio/metrics.ts) и пороги (LIMITS: пик, сумма после ограничителя, щелчок
//      на краях, хвост тишины); громкость сверяется с базовой линией tools/sound-baseline.json (±1 LU);
//      радио — голос громче помех на 10 дБ (lab.radioSnr).
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
/** Голос радио громче помех, дБ (план звука, срез 3). */
const RADIO_SNR_MIN = 10;

/** Вспышки надписи по сэмплам прозрачности: подъём выше 0,9 после спада ниже 0,6. */
export function countFlashes(samples) {
  let n = 0;
  let low = true;
  for (const [, o] of samples) {
    if (low && o >= 0.9) {
      n += 1;
      low = false;
    } else if (!low && o <= 0.6) low = true;
  }
  return n;
}

/** Промежуточные значения перехода: сколько сэмплов строго между концами. */
export function midSamples(samples, from, to) {
  const lo = Math.min(from, to) + 0.05;
  const hi = Math.max(from, to) - 0.05;
  return samples.filter(([, v]) => v > lo && v < hi).length;
}

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

    // 1. Без жеста — заставка «Включить радио» и тишина
    await client.send('Page.navigate', { url: base });
    await waitFor(() => client.eval('!!window.sedmaya?.sound?.engine'), 30000, 'игра загрузилась');
    await sleep(SILENT_MS);
    const silent = await client.eval(`({
      ctx: window.sedmaya.sound.engine.ctx === null,
      made: window.__audioContexts,
      played: window.sedmaya.sound.engine.played.length,
      splash: !!document.querySelector('.rs .rs-on'),
      focused: document.activeElement?.classList.contains('rs-on') ?? false,
    })`);
    step(silent.splash && silent.focused, 'заставка «Включить радио» на экране, фокус на кнопке');
    step(
      silent.ctx && silent.made === 0 && silent.played === 0,
      `без жеста ${SILENT_MS / 1000} с: контекстов ${silent.made}, сыграно звуков ${silent.played}`,
    );

    // 2. «Включить радио» — контекст запущен, заставка уходит, ветер и радио, надпись мигает по словам.
    // Сэмплы пишет сама страница по кадрам: прозрачность заставки и надписи, моменты слов.
    await client.eval(`(() => {
      const rec = (window.__radio = { splash: [], call: [], words: [] });
      const t0 = performance.now();
      const tick = () => {
        const t = Math.round(performance.now() - t0);
        const rs = document.querySelector('.rs');
        if (rs) rec.splash.push([t, +getComputedStyle(rs).opacity]);
        const call = document.querySelector('.start-call');
        if (call) rec.call.push([t, +getComputedStyle(call).opacity]);
        if (t < 16000) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      new MutationObserver(() => {
        const call = document.querySelector('.start-call.is-on-air');
        if (call && rec.words.at(-1)?.[1] !== call.dataset.word)
          rec.words.push([Math.round(performance.now() - t0), call.dataset.word]);
      }).observe(document.getElementById('ui'), { subtree: true, attributes: true, attributeFilter: ['class', 'data-word'] });
    })()`);
    const btn = await client.eval(`(() => {
      const r = document.querySelector('.rs-on').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    for (const type of ['mousePressed', 'mouseReleased'])
      await client.send('Input.dispatchMouseEvent', { type, x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
    const running = await waitFor(
      () => client.eval('window.sedmaya.sound.engine.ctx?.state === "running"'),
      5000,
      'контекст после клика',
    ).catch(() => false);
    step(running, 'после «Включить радио» AudioContext запущен (running)');
    if (running) {
      await sleep(1500);
      const wind = await client.eval('window.sedmaya.sound.ambience.readout()?.wind ?? 0');
      step(wind > 0.01, `на стартовом экране ветер: ${fmt(wind, 3)}`);
      await waitFor(() => client.eval('!!document.querySelector(".start-call.is-heard")'), 12000, 'фраза радио').catch(
        () => false,
      );
      const r = await client.eval(`({
        rec: window.__radio,
        played: window.sedmaya.sound.engine.played.map(([n]) => n),
      })`);
      step(r.played.includes('radio'), `радио прозвучало (played: ${r.played.join(', ')})`);
      const leave = r.rec.splash.filter(([, o]) => o < 0.999);
      step(
        midSamples(r.rec.splash, 0, 1) >= 2,
        `заставка уходит плавно: ${leave.length} кадров, ${leave.map(([t, o]) => `${t}:${o.toFixed(2)}`).join(' ')}`,
      );
      const words = r.rec.words.map(([t, w]) => `${w}@${t}`).join(' ');
      step(r.rec.words.length === 3, `«Всем! Всем! Всем!»: слов по классу ${r.rec.words.length} (${words})`);
      // окно слов: от первого до конца последнего (после фразы надпись плавно загорается ровно — это не вспышка)
      const first = r.rec.words[0]?.[0] ?? 0;
      const last = r.rec.words.at(-1)?.[0] ?? first;
      const after = r.rec.call.filter(([t]) => t >= first - 200 && t <= last + 1200);
      const flashes = countFlashes(after);
      const sample = after
        .filter((_, i) => i % 6 === 0)
        .map(([t, o]) => `${t}:${o.toFixed(2)}`)
        .slice(0, 40)
        .join(' ');
      step(flashes === 3, `вспышек надписи по прозрачности ${flashes} (нужно 3); сэмплы ${sample}`);
      const music = await waitFor(
        () => client.eval('window.sedmaya.sound.music.current'),
        4000,
        'мелодия после фразы',
      ).catch(() => null);
      step(!!music, `после фразы — мелодия дня (${music ?? 'нет'})`);
    }

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

    // 4б. События в игре (срез 4): рычаг, листок календаря в кадр с is-turn, сброс яруса в такт падению
    const played = () => client.eval('window.sedmaya.sound.engine.played.map(([n, t]) => [n, t])');
    const lever = (await played()).some(([n]) => n === 'sample:lever' || n === 'lever');
    step(lever, 'смена режима двигателя — рычаг (lever)');
    await client.eval('window.sedmaya.store.dispatch((s) => ({ ...s, day: s.day + 1 }))');
    // меньше CAL_WAIT (700 мс в index.ts): звук должен прийти по is-turn, а не по запасному таймеру
    await sleep(350);
    const leaf = await client.eval(`({
      turn: !!document.querySelector('.hud-leaf.is-turn'),
      played: window.sedmaya.sound.engine.played.some(([n]) => n === 'sample:paperTear' || n === 'paper'),
    })`);
    step(leaf.turn && leaf.played, `новый день — листок отрывается со звуком (is-turn ${leaf.turn})`);
    await client.eval(
      'window.sedmaya.store.dispatch((s) => ({ ...s, tiers: s.tiers.slice(0, Math.max(1, s.tiers.length - 1)) }))',
    );
    await sleep(300);
    const drop = await played();
    const start = drop.findLast(([n]) => n === 'tierDrop')?.[1];
    const thud = drop.findLast(([n]) => n === 'tierDrop:thud')?.[1];
    const fallMs = 1100; // FALL_MS в src/scenes/tower-dom.ts (тест audio.test.ts сверяет с DROP.fall)
    const lag = start != null && thud != null ? thud - start - fallMs / 1000 : NaN;
    step(
      lag >= 0 && lag <= 0.6,
      `сброс яруса: удар через ${fmt(lag * 1000, 0)} мс после конца падения (${fallMs} мс), нужно 0…600`,
    );

    // Радио в окне «Сигнал» дня 6: тихо по кругу, музыка −10 дБ
    await client.send('Page.navigate', { url: `${base}?event=d06_signal` });
    await waitFor(() => client.eval('!!document.querySelector(".ev-layer[data-event=d06_signal]")'), 30000, 'окно «Сигнал»');
    for (const type of ['mousePressed', 'mouseReleased'])
      await client.send('Input.dispatchMouseEvent', { type, x: 8, y: 450, button: 'left', clickCount: 1 });
    await sleep(2500);
    const sig = await client.eval(`({
      played: window.sedmaya.sound.engine.played.map(([n]) => n),
      duck: window.sedmaya.sound.engine.ducking('music'),
    })`);
    step(sig.played.includes('radio'), `окно «Сигнал»: радио звучит (${sig.played.join(', ')})`);
    step(
      sig.duck.gain <= 10 ** (-10 / 20) + 0.01,
      `окно «Сигнал»: музыка приглушена, множитель ${fmt(sig.duck.gain, 2)} (≤ −10 дБ)`,
    );

    // Комикс: облачко рации — всплеск помех
    await client.send('Page.navigate', { url: `${base}?comic=outro_harbor` });
    await waitFor(() => client.eval('!!document.querySelector(".cx-layer")'), 30000, 'комикс');
    for (const type of ['mousePressed', 'mouseReleased'])
      await client.send('Input.dispatchMouseEvent', { type, x: 8, y: 450, button: 'left', clickCount: 1 });
    const burst = await waitFor(
      () => client.eval('window.sedmaya.sound.engine.played.some(([n]) => n === "radioBurst")'),
      8000,
      'помехи у облачка рации',
    ).catch(() => false);
    step(burst, 'комикс: у облачка рации — помехи (radioBurst)');

    // 5. Лаборатория: рендер и метрики
    await client.send('Page.navigate', { url: `${base}?sound=lab` });
    await waitFor(() => client.eval('!!window.sedmaya?.sound?.lab'), 30000, 'лаборатория ?sound=lab');
    const rows = await client.eval('window.sedmaya.sound.lab.measure()');
    const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};
    console.log(`\nМетрики по рендеру (${rows.length} звуков; пик — сумма шин, огр. — после ограничителя):`);
    console.log(table(rows, baseline));
    for (const r of rows) for (const e of r.errors) step(false, `${r.id}: ${e}`);
    const snr = await client.eval('window.sedmaya.sound.lab.radioSnr()');
    step(
      snr.snr >= RADIO_SNR_MIN,
      `радио: голос ${fmt(snr.voice)} дБ, помехи ${fmt(snr.noise)} дБ — запас ${fmt(snr.snr)} дБ (нужно ≥ ${RADIO_SNR_MIN})`,
    );
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
