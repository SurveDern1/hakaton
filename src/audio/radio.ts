// Радио башни: «Всем! Всем! Всем!» сквозь эфир. Тракт рации синтезируется Web Audio:
// настройка (свист гетеродина 2000→400 Гц и нарастание помех) → голос из файла radio-vsem.mp3
// (samples.ts, `radioVoice`; срез 6) или замена — морзянка «ВСЕМ» (·−− ··· · −−) тоном 700 Гц →
// полоса 300–3000 Гц, перегруз WaveShaper, дрожание громкости 6–9 Гц и медленные замирания,
// полоса шума и треск → хвост шумоподавителя.
// Порядок: playRadio(engine) ставит всё на часы контекста и возвращает RadioHandle; интерфейс
// подписывается на onWord(i) (начало каждого «Всем!») и ждёт done. Без звука (выключен, нет жеста) —
// null: интерфейс мигает надписью сам, по таймеру. Где звучит: стартовый экран (index.ts → radioIntro),
// окно «Сигнал» дня 6 (тихо, по кругу), всплеск помех у облачка рации в комиксе (playRadioBurst).
import type { AudioEngine } from './audio';
import { SAMPLES, sampleBuffer } from './samples';
import { noise, panTo } from './synth';

/** Морзянка нужных букв: точка — одна единица, тире — три. */
const MORSE: Record<string, string> = { В: '.--', С: '...', Е: '.', М: '--' };

/** Числа тракта и морзянки; громкости — доли шины звуков. */
export const RADIO = {
  /** Слово, которое повторяет радио. */
  word: 'ВСЕМ',
  /** Сколько раз: «Всем! Всем! Всем!». */
  repeats: 3,
  /** Единица морзянки, с: точка; тире — три, пауза в букве — одна, между буквами — три. */
  unit: 0.048,
  /** Пауза между словами, с. */
  wordGap: 0.5,
  /** Настройка до первого слова, с. */
  tune: 1.3,
  /** Хвост шумоподавителя после голоса, с. */
  tail: 0.45,
  /** Тон морзянки, Гц. */
  tone: 700,
  /** Свист гетеродина при настройке, Гц: от и до. */
  whistle: [2000, 400] as [number, number],
  /** Полоса рации, Гц. */
  band: [300, 3000] as [number, number],
  /** Громкость голоса (морзянки) в тракте. */
  voice: 0.42,
  /** Помехи: на пике настройки, под голосом и вспышка шумоподавителя. */
  staticTune: 0.3,
  staticUnder: 0.1,
  staticSquelch: 0.26,
  /** Общий уровень радио. */
  level: 0.26,
};

/** Сигналы одного слова морзянкой: [начало, длина] в секундах от начала слова и длина слова. */
export function morseBeeps(word: string, unit = RADIO.unit): { beeps: [number, number][]; length: number } {
  const beeps: [number, number][] = [];
  let t = 0;
  const letters = [...word.toUpperCase()].filter((ch) => MORSE[ch]);
  letters.forEach((ch, li) => {
    const code = MORSE[ch] as string;
    [...code].forEach((sym, si) => {
      const len = sym === '-' ? 3 * unit : unit;
      beeps.push([t, len]);
      t += len;
      if (si < code.length - 1) t += unit;
    });
    if (li < letters.length - 1) t += 3 * unit;
  });
  return { beeps, length: t };
}

export interface RadioScript {
  /** Длина настройки, с: первое слово начинается здесь. */
  tune: number;
  /** Сигналы морзянки от начала радио, с; у голоса из файла — пусто. */
  beeps: [number, number][];
  /** Начала слов от начала радио, с: по ним мигает надпись. */
  words: number[];
  /** Конец голоса, с. */
  voiceEnd: number;
  /** Вся длина с хвостом шумоподавителя, с. */
  length: number;
}

/**
 * Расписание фразы. `voice` — голос из файла: длина и отметки слов (секунды от начала файла);
 * без него — морзянка «ВСЕМ» `RADIO.repeats` раз.
 */
export function radioScript(voice?: { length: number; words: number[] }): RadioScript {
  const tune = RADIO.tune;
  if (voice) {
    const voiceEnd = tune + voice.length;
    return {
      tune,
      beeps: [],
      words: voice.words.map((w) => tune + w),
      voiceEnd,
      length: voiceEnd + RADIO.tail,
    };
  }
  const one = morseBeeps(RADIO.word);
  const beeps: [number, number][] = [];
  const words: number[] = [];
  let t = tune;
  for (let i = 0; i < RADIO.repeats; i++) {
    words.push(t);
    for (const [s, d] of one.beeps) beeps.push([t + s, d]);
    t += one.length + (i < RADIO.repeats - 1 ? RADIO.wordGap : 0);
  }
  return { tune, beeps, words, voiceEnd: t, length: t + RADIO.tail };
}

export interface RadioOpts {
  /** Множитель громкости: в окне «Сигнал» радио звучит тише, на фоне. */
  gain?: number;
  /** Приглушить музыку и атмосферу на время фразы. */
  duck?: boolean;
  delay?: number;
  pan?: number;
  /** Куда играть вместо шины звуков. */
  dest?: AudioNode;
  /** Только голос или только помехи — для замера «голос громче помех» в лаборатории. */
  part?: 'all' | 'voice' | 'static';
}

export interface RadioHandle {
  script: RadioScript;
  /** Время контекста начала фразы. */
  at: number;
  /** Подписка на начало слова i (0, 1, 2); в живом звуке — по таймеру, в рендере не вызывается. */
  onWord(fn: (i: number) => void): void;
  /** Фраза и хвост отзвучали (или остановлены). */
  done: Promise<void>;
  /** Оборвать: быстрое затухание за 0,3 с, слова дальше не приходят. */
  stop(): void;
}

/** Тракт рации: вход → полоса → перегруз → дрожание и замирания → выход; помехи — во второй вход. */
function radioChain(e: AudioEngine, t: number, end: number, level: number, dest: AudioNode, pan?: number) {
  const ctx = e.ctx as BaseAudioContext;
  const input = ctx.createGain();
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = RADIO.band[0];
  hp.Q.value = 0.7;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = RADIO.band[1];
  lp.Q.value = 0.7;
  const shaper = ctx.createWaveShaper();
  shaper.curve = radioCurve(2.4);
  shaper.oversample = '2x';
  // после перегруза — снова полоса: гармоники выше 3 кГц срезаны, как у динамика рации
  const lp2 = ctx.createBiquadFilter();
  lp2.type = 'lowpass';
  lp2.frequency.value = RADIO.band[1] * 1.2;
  const staticIn = ctx.createGain();
  // дрожание 6–9 Гц и медленные замирания эфира
  const trem = ctx.createGain();
  trem.gain.value = 0.8;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 6 + e.rnd() * 3;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 0.1;
  const fade = ctx.createOscillator();
  fade.frequency.value = 0.3 + e.rnd() * 0.2;
  const fadeDepth = ctx.createGain();
  fadeDepth.gain.value = 0.1;
  lfo.connect(lfoDepth).connect(trem.gain);
  fade.connect(fadeDepth).connect(trem.gain);
  const out = ctx.createGain();
  // края: подъём и спад 10 мс — фраза не щёлкает ни в начале, ни при обрыве
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(level, t + 0.01);
  out.gain.setValueAtTime(level, end - 0.03);
  out.gain.linearRampToValueAtTime(0, end);
  input.connect(hp).connect(lp).connect(shaper).connect(lp2).connect(trem);
  staticIn.connect(trem);
  trem.connect(out).connect(panTo(ctx, dest, pan, t));
  for (const o of [lfo, fade]) {
    o.start(t);
    o.stop(end + 0.05);
  }
  return { input, staticIn, out };
}

/** Мягкий перегруз с лёгкой несимметрией: рация «хрипит», но не рвётся. */
function radioCurve(drive: number, n = 1024): Float32Array<ArrayBuffer> {
  const c = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(drive * (x + 0.08 * x * x)) / norm;
  }
  return c;
}

/** Треск эфира: короткие щелчки шума в случайные моменты [from, to). */
function crackle(e: AudioEngine, dest: AudioNode, from: number, to: number, perSec: number, gain: number) {
  const n = Math.round((to - from) * perSec);
  for (let i = 0; i < n; i++) {
    const at = from + e.rnd() * Math.max(0, to - from - 0.03);
    noise(e, {
      t: at,
      dur: 0.002 + e.rnd() * 0.004,
      release: 0.012,
      gain: gain * (0.4 + e.rnd() * 0.6),
      dest,
      filter: 'highpass',
      freq: 2200,
    });
  }
}

/**
 * «Всем! Всем! Всем!» по радио. Возвращает расписание и подписку на слова или null, если звук выключен
 * или ещё не разблокирован жестом.
 */
export function playRadio(e: AudioEngine, opts: RadioOpts = {}): RadioHandle | null {
  const ctx = e.ctx;
  if (!ctx || !e.ready || !e.sfxAudible) return null;
  const part = opts.part ?? 'all';
  const voiceBuf = sampleBuffer('radioVoice');
  const marks = SAMPLES.radioVoice.words;
  const script = radioScript(
    voiceBuf && marks?.length ? { length: voiceBuf.duration, words: marks } : undefined,
  );
  const t = ctx.currentTime + 0.02 + (opts.delay ?? 0);
  const end = t + script.length;
  const chain = radioChain(e, t, end, RADIO.level * (opts.gain ?? 1), opts.dest ?? e.sfxBus, opts.pan);

  // Настройка: свист гетеродина плывёт сверху вниз и тонет в помехах
  if (part !== 'voice') {
    const w = ctx.createOscillator();
    w.frequency.setValueAtTime(RADIO.whistle[0], t);
    w.frequency.exponentialRampToValueAtTime(RADIO.whistle[1], t + script.tune * 0.85);
    const wg = ctx.createGain();
    wg.gain.setValueAtTime(0, t);
    wg.gain.linearRampToValueAtTime(0.1, t + 0.25);
    wg.gain.linearRampToValueAtTime(0.06, t + script.tune * 0.7);
    wg.gain.linearRampToValueAtTime(0, t + script.tune * 0.92);
    w.connect(wg).connect(chain.input);
    w.start(t);
    w.stop(t + script.tune);

    // Полоса помех: растёт при настройке, под голосом стихает, в конце — вспышка шумоподавителя
    const buf = e.noiseBuffer('white');
    if (buf) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1700;
      bp.Q.value = 0.6;
      const g = ctx.createGain();
      const v0 = t + script.tune;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(RADIO.staticTune, t + script.tune * 0.8);
      g.gain.linearRampToValueAtTime(RADIO.staticUnder, v0);
      g.gain.setValueAtTime(RADIO.staticUnder, script.voiceEnd + t);
      g.gain.linearRampToValueAtTime(RADIO.staticSquelch, t + script.voiceEnd + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0005, end - 0.05);
      g.gain.linearRampToValueAtTime(0, end);
      src.connect(bp).connect(g).connect(chain.staticIn);
      src.start(t, e.rnd() * (buf.duration - 0.1));
      src.stop(end + 0.02);
    }
    crackle(e, chain.staticIn, t, end - 0.1, 5, 0.12);
  }

  // Голос: файл или морзянка
  if (part !== 'static') {
    if (voiceBuf && marks?.length) {
      const src = ctx.createBufferSource();
      src.buffer = voiceBuf;
      const g = ctx.createGain();
      g.gain.value = RADIO.voice * 1.6;
      src.connect(g).connect(chain.input);
      src.start(t + script.tune);
    } else {
      const osc = ctx.createOscillator();
      osc.frequency.value = RADIO.tone;
      const key = ctx.createGain();
      key.gain.setValueAtTime(0, t);
      const ramp = 0.006;
      for (const [s, d] of script.beeps) {
        key.gain.setValueAtTime(0, t + s);
        key.gain.linearRampToValueAtTime(RADIO.voice, t + s + ramp);
        key.gain.setValueAtTime(RADIO.voice, t + s + d - ramp);
        key.gain.linearRampToValueAtTime(0, t + s + d);
      }
      osc.connect(key).connect(chain.input);
      osc.start(t + script.tune - 0.02);
      osc.stop(t + script.voiceEnd + 0.02);
    }
  }

  e.played.push(['radio', Math.round(t * 100) / 100]);
  if (e.played.length > 40) e.played.shift();

  // в рендере часов нет, отпустить вовремя нечем: приглушение — только в живом звуке
  const releases =
    opts.duck && !e.offlineMode ? [e.duck('music', -12, 0.4, 1.5), e.duck('amb', -6, 0.4, 1.5)] : [];
  const listeners: ((i: number) => void)[] = [];
  const timers: number[] = [];
  let finish: () => void = () => undefined;
  const done = new Promise<void>((ok) => {
    finish = ok;
  });
  let over = false;
  const close = () => {
    if (over) return;
    over = true;
    for (const id of timers) window.clearTimeout(id);
    for (const r of releases) r();
    finish();
  };
  if (!e.offlineMode) {
    const ms = (at: number) => Math.max(0, (at - ctx.currentTime) * 1000);
    script.words.forEach((w, i) => {
      timers.push(
        window.setTimeout(
          () => {
            for (const fn of listeners) fn(i);
          },
          ms(t + w),
        ),
      );
    });
    // приглушение отпускаем с концом голоса: хвост шумоподавителя звучит уже под возвращающуюся музыку
    const release = () => {
      for (const r of releases) r();
    };
    timers.push(window.setTimeout(release, ms(t + script.voiceEnd)));
    timers.push(window.setTimeout(close, ms(end)));
  }
  return {
    script,
    at: t,
    onWord: (fn) => listeners.push(fn),
    done,
    stop() {
      if (over) return;
      const now = ctx.currentTime;
      chain.out.gain.cancelScheduledValues(now);
      chain.out.gain.setValueAtTime(chain.out.gain.value, now);
      chain.out.gain.linearRampToValueAtTime(0, now + 0.3);
      close();
    },
  };
}

/** Всплеск помех у облачка рации в комиксе: щелчок включения, шум, обрывок свиста, шумоподавитель. */
export function playRadioBurst(
  e: AudioEngine,
  delay = 0,
  opts: { dest?: AudioNode; gain?: number } = {},
): boolean {
  const ctx = e.ctx;
  if (!ctx || !e.ready || !e.sfxAudible) return false;
  const t = ctx.currentTime + 0.01 + delay;
  const len = 0.62;
  const end = t + len;
  const chain = radioChain(e, t, end, RADIO.level * 1.6 * (opts.gain ?? 1), opts.dest ?? e.sfxBus);
  const buf = e.noiseBuffer('white');
  if (buf) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2200, t);
    bp.frequency.exponentialRampToValueAtTime(1200, end);
    bp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.32, t + 0.02);
    g.gain.linearRampToValueAtTime(0.18, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0005, end - 0.04);
    g.gain.linearRampToValueAtTime(0, end);
    src.connect(bp).connect(g).connect(chain.staticIn);
    src.start(t, e.rnd() * (buf.duration - 1));
    src.stop(end + 0.02);
  }
  const w = ctx.createOscillator();
  const f0 = 1400 + e.rnd() * 600;
  w.frequency.setValueAtTime(f0, t + 0.08);
  w.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + 0.36);
  const wg = ctx.createGain();
  wg.gain.setValueAtTime(0, t + 0.08);
  wg.gain.linearRampToValueAtTime(0.08, t + 0.14);
  wg.gain.linearRampToValueAtTime(0, t + 0.36);
  w.connect(wg).connect(chain.input);
  w.start(t + 0.08);
  w.stop(t + 0.4);
  crackle(e, chain.staticIn, t, end - 0.1, 14, 0.14);
  e.played.push(['radioBurst', Math.round(t * 100) / 100]);
  if (e.played.length > 40) e.played.shift();
  return true;
}
