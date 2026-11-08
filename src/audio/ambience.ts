// Постоянный фон башни на шине атмосферы (engine.ambBus): ветер, двигатель, Мгла, скрипы.
// Цели приходят из soundscape.ts (чистая функция); здесь узлы только плавно идут к ним (setTargetAtTime:
// двигатель τ≈0,6 с, Мгла ≈1,5 с, ветер ≈2 с), а случайные события — порывы, свист, перебои, шёпот,
// иней, скрипы — ставит планировщик schedule(до) на часы AudioContext.
// Живой движок: start() → таймер ставит события на секунду вперёд. Без колонок (AudioEngine.offline):
// start() → set(цели, true) → schedule(длина рендера) → render(). Так лаборатория и check:sound меряют фон.
// Около 30 постоянных узлов; события короткоживущие и сами себя останавливают.
import type { AudioEngine } from './audio';
import { playSample, type SampleName, sampleBuffer } from './samples';
import type { AmbTargets } from './soundscape';
import { noise, panTo, vary } from './synth';

/** Общий уровень слоёв до шины атмосферы (подбирался по громкости рендера, −30…−24 LUFS). */
const LEVEL = { wind: 0.55, engine: 0.1, mist: 0.4, creak: 0.35 } as const;
/** Постоянные времени переходов, с. */
const TAU = { wind: 2, engine: 0.6, mist: 1.5 } as const;
/** Как далеко вперёд живой таймер ставит события, с, и как часто он срабатывает, мс. */
const LOOKAHEAD = 1;
const TICK_MS = 200;
/** Гармоники двигателя f0/2f0/3f0 и их доли до насыщения. */
const HARMONICS: [number, number][] = [
  [1, 0.35],
  [2, 0.4],
  [3, 0.35],
];
/** Гласные «шёпота» Мглы: три форманты, Гц. */
const VOWELS: [number, number, number][] = [
  [800, 1150, 2900],
  [450, 800, 2830],
  [325, 700, 2700],
  [400, 1600, 2700],
  [270, 2140, 2950],
];

export interface AmbienceOpts {
  /** Какие слои строить (для замеров по отдельности); по умолчанию все. */
  layers?: Partial<Record<'wind' | 'engine' | 'mist' | 'creak', boolean>>;
}

interface WindSide {
  band: BiquadFilterNode;
  gust: GainNode;
}

interface Graph {
  out: GainNode;
  wind: {
    gain: GainNode;
    far: GainNode;
    sides: WindSide[];
    whistle: BiquadFilterNode;
    whistleGain: GainNode;
  };
  engine: {
    gain: GainNode;
    oscs: OscillatorNode[];
    lowpass: BiquadFilterNode;
    pulse: GainNode;
    lfo: OscillatorNode;
    lfoDepth: GainNode;
    stutter: GainNode;
    turbine: OscillatorNode;
    turbineGain: GainNode;
    flowGain: GainNode;
  };
  mist: {
    gain: GainNode;
    open: BiquadFilterNode;
    formants: BiquadFilterNode[];
    whisperGain: GainNode;
    syllable: GainNode;
  };
  creak: GainNode;
  sources: AudioScheduledSourceNode[];
}

type Stream = 'gustL' | 'gustR' | 'whistle' | 'stutter' | 'vowel' | 'syllable' | 'crackle' | 'creak';

export class Ambience {
  /** Текущие цели (последние, что пришли в set). */
  targets: AmbTargets | null = null;
  private g: Graph | null = null;
  private pinned: AmbTargets | null = null;
  private next: Record<Stream, number> = {
    gustL: 0,
    gustR: 0.9,
    whistle: 4,
    stutter: 0,
    vowel: 0,
    syllable: 0,
    crackle: 0,
    creak: 6,
  };
  private timer = 0;
  private readonly layers: Required<NonNullable<AmbienceOpts['layers']>>;

  constructor(
    private e: AudioEngine,
    opts: AmbienceOpts = {},
  ) {
    const l = opts.layers ?? {};
    this.layers = {
      wind: l.wind !== false,
      engine: l.engine !== false,
      mist: l.mist !== false,
      creak: l.creak !== false,
    };
  }

  get started(): boolean {
    return this.g !== null;
  }

  /** Построить слои (контекст уже есть) и, на живом движке, запустить таймер событий. */
  start(): void {
    const ctx = this.e.ctx;
    if (this.g || !ctx) return;
    this.g = this.build(ctx);
    const t0 = ctx.currentTime;
    for (const k of Object.keys(this.next) as Stream[]) this.next[k] += t0;
    if (this.targets) this.apply(this.targets, true);
    if (!this.e.offlineMode) {
      this.timer = window.setInterval(() => this.tick(), TICK_MS);
      this.tick();
    }
  }

  /** Новые цели из игры; пока лаборатория закрепила свои — запоминаются, но не звучат. */
  set(t: AmbTargets, instant = false): void {
    this.targets = t;
    if (!this.pinned) this.apply(t, instant);
  }

  /** Лаборатория: закрепить цели поверх игровых (null — вернуть игровые). */
  pin(t: AmbTargets | null): void {
    this.pinned = t;
    const now = t ?? this.targets;
    if (now) this.apply(now, false);
  }

  /** Остановить таймер событий и слои (лаборатория, повторная инициализация). */
  stop(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
    const g = this.g;
    if (!g) return;
    for (const s of g.sources) {
      try {
        s.stop();
      } catch {
        // уже остановлен
      }
    }
    g.out.disconnect();
    this.g = null;
  }

  /** Что сейчас звучит: для индикатора лаборатории и отладки из консоли. */
  readout(): { f0: number; cutoff: number; engine: number; wind: number; mist: number } | null {
    const g = this.g;
    if (!g) return null;
    return {
      f0: g.engine.oscs[0]?.frequency.value ?? 0,
      cutoff: g.engine.lowpass.frequency.value,
      engine: g.engine.gain.gain.value,
      wind: g.wind.gain.gain.value,
      mist: g.mist.gain.gain.value,
    };
  }

  private get now(): AmbTargets | null {
    return this.pinned ?? this.targets;
  }

  private tick(): void {
    const ctx = this.e.ctx;
    if (!ctx) return;
    this.schedule(ctx.currentTime + LOOKAHEAD);
  }

  /**
   * Поставить случайные события до момента `until` (часы контекста). Без целей или при выключенной
   * атмосфере время просто проходит: после включения события не сыплются пачкой.
   */
  schedule(until: number): void {
    const ctx = this.e.ctx;
    const g = this.g;
    const t = this.now;
    if (!ctx || !g) return;
    const from = ctx.currentTime;
    const rnd = this.e.rnd;
    const quiet = !t || !this.e.ambienceAudible;
    const run = (k: Stream, every: (at: number) => number | null, fire: (at: number) => void) => {
      if (this.next[k] < from) this.next[k] = from + rnd() * 0.2;
      while (this.next[k] < until) {
        const at = this.next[k];
        const gap = every(at);
        if (gap === null) {
          this.next[k] = until;
          return;
        }
        if (!quiet) fire(at);
        this.next[k] = at + Math.max(0.05, gap);
      }
    };
    if (quiet) {
      for (const k of Object.keys(this.next) as Stream[])
        run(
          k,
          () => null,
          () => undefined,
        );
      return;
    }

    // Ветер: каждые 2–4 с у каждой стороны своя цель громкости и полосы — порывы ходят слева направо
    if (this.layers.wind) {
      g.wind.sides.forEach((side, i) => {
        run(
          i === 0 ? 'gustL' : 'gustR',
          () => 2 + rnd() * 2,
          (at) => {
            const w = t.wind;
            const level = 1 - w.gust * rnd() * 0.85;
            const tau = 0.5 + rnd() * 0.9;
            side.gust.gain.setTargetAtTime(level, at, tau);
            side.band.frequency.setTargetAtTime(w.center * (0.65 + rnd() * (0.5 + w.gust)), at, tau * 1.3);
          },
        );
      });
      run(
        'whistle',
        () => (Number.isFinite(t.wind.whistleEvery) ? t.wind.whistleEvery * (0.5 + rnd()) : null),
        (at) => {
          const f = 600 + rnd() * 600;
          const len = 1.2 + rnd() * 1.8;
          g.wind.whistle.frequency.setValueAtTime(f, at);
          g.wind.whistle.frequency.linearRampToValueAtTime(f * vary(rnd, 12), at + len);
          g.wind.whistleGain.gain.setTargetAtTime(0.5 + rnd() * 0.5, at, len / 4);
          g.wind.whistleGain.gain.setTargetAtTime(0, at + len * 0.6, len / 5);
        },
      );
    }

    // Двигатель: перебои при низком эфире — провал громкости и «кашель» тона раз в 0,5–2 с
    if (this.layers.engine) {
      run(
        'stutter',
        () => (t.engine.stutter > 0 ? 0.5 + rnd() * 1.5 * (1.2 - t.engine.stutter) : null),
        (at) => {
          const s = t.engine.stutter;
          const depth = Math.min(0.92, s * (0.55 + rnd() * 0.45));
          const hold = 0.06 + rnd() * 0.2;
          const p = g.engine.stutter.gain;
          p.setTargetAtTime(1 - depth, at, 0.02);
          p.setTargetAtTime(1, at + hold, 0.06 + rnd() * 0.1);
          for (const o of g.engine.oscs) {
            o.detune.setTargetAtTime(-120 * s * rnd(), at, 0.03);
            o.detune.setTargetAtTime(0, at + hold, 0.12);
          }
        },
      );
    }

    // Мгла: гласные шёпота плывут, слоги дышат, иней потрескивает
    if (this.layers.mist) {
      run(
        'vowel',
        () => 1.5 + rnd() * 1.5,
        (at) => {
          const v = VOWELS[Math.floor(rnd() * VOWELS.length)] as [number, number, number];
          for (const [i, f] of g.mist.formants.entries())
            f.frequency.setTargetAtTime((v[i] ?? 1000) * vary(rnd, 6), at, 0.7);
        },
      );
      run(
        'syllable',
        () => 0.35 + rnd() * 0.6,
        (at) => {
          g.mist.syllable.gain.setTargetAtTime(0.25 + rnd() * 0.75, at, 0.12 + rnd() * 0.15);
        },
      );
      run(
        'crackle',
        () => (t.mist.crackle > 0 ? -Math.log(1 - rnd() * 0.999) / t.mist.crackle : null),
        (at) => {
          noise(this.e, {
            t: at,
            dur: 0.002 + rnd() * 0.004,
            attack: 0.001,
            release: 0.02 + rnd() * 0.03,
            gain: 0.12 + rnd() * 0.18,
            dest: g.mist.gain,
            filter: 'bandpass',
            freq: 3000 + rnd() * 3000,
            q: 3,
            pan: rnd() * 1.6 - 0.8,
          });
        },
      );
    }

    // Скрипы башни: файл, если загружен, иначе синтезированное трение
    if (this.layers.creak) {
      run(
        'creak',
        () => (Number.isFinite(t.creakEvery) ? Math.max(2, t.creakEvery * (0.4 + rnd() * 1.2)) : null),
        (at) => this.creak(at),
      );
    }
  }

  private creak(at: number): void {
    const g = this.g;
    const ctx = this.e.ctx;
    if (!g || !ctx) return;
    const rnd = this.e.rnd;
    const name: SampleName = rnd() < 0.35 ? 'creakMetal' : 'creakWood';
    const pan = rnd() * 1.2 - 0.6;
    if (sampleBuffer(name)) {
      playSample(this.e, name, {
        amb: true,
        dest: g.creak,
        rate: 0.85 + rnd() * 0.3,
        pan,
        delay: Math.max(0, at - ctx.currentTime - 0.01),
      });
      return;
    }
    synthCreak(this.e, at, g.creak, pan, name === 'creakMetal');
  }

  /** Довести узлы до целей: громкости слоёв по своим τ, тон и фильтры двигателя за ≈0,6 с. */
  private apply(t: AmbTargets, instant: boolean): void {
    const g = this.g;
    const ctx = this.e.ctx;
    if (!g || !ctx) return;
    const at = ctx.currentTime;
    const go = (p: AudioParam, v: number, tau: number) => {
      p.cancelScheduledValues(at);
      if (instant) p.setValueAtTime(v, at);
      else {
        p.setValueAtTime(p.value, at);
        p.setTargetAtTime(v, at, Math.max(tau, t.fade));
      }
    };
    const L = this.layers;
    go(g.wind.gain.gain, L.wind ? t.wind.gain * LEVEL.wind : 0, TAU.wind);
    go(g.wind.far.gain, t.wind.far, TAU.wind);

    const en = t.engine;
    go(g.engine.gain.gain, L.engine ? en.gain * LEVEL.engine : 0, TAU.engine);
    for (const [i, o] of g.engine.oscs.entries())
      go(o.frequency, en.f0 * (HARMONICS[i]?.[0] ?? 1), TAU.engine);
    go(g.engine.lowpass.frequency, en.cutoff, TAU.engine);
    go(g.engine.lfo.frequency, en.pulseHz, TAU.engine);
    go(g.engine.lfoDepth.gain, en.pulseDepth / 2, TAU.engine);
    go(g.engine.pulse.gain, 1 - en.pulseDepth / 2, TAU.engine);
    go(g.engine.turbine.frequency, en.f0 * 18, TAU.engine);
    go(g.engine.turbineGain.gain, en.turbine, TAU.engine);
    go(g.engine.flowGain.gain, en.flow, TAU.engine);

    const mi = t.mist;
    go(g.mist.gain.gain, L.mist ? mi.gain * LEVEL.mist : 0, TAU.mist);
    go(g.mist.open.frequency, mi.open, TAU.mist);
    go(g.mist.whisperGain.gain, mi.whisper, TAU.mist);
    go(g.creak.gain, L.creak ? LEVEL.creak : 0, TAU.mist);
  }

  private build(ctx: BaseAudioContext): Graph {
    const e = this.e;
    const rnd = e.rnd;
    const sources: AudioScheduledSourceNode[] = [];
    const gain = (v: number, to?: AudioNode | AudioParam) => {
      const n = ctx.createGain();
      n.gain.value = v;
      if (to instanceof AudioParam) n.connect(to);
      else if (to) n.connect(to);
      return n;
    };
    const filter = (type: BiquadFilterType, f: number, q: number, to?: AudioNode) => {
      const n = ctx.createBiquadFilter();
      n.type = type;
      n.frequency.value = f;
      n.Q.value = q;
      if (to) n.connect(to);
      return n;
    };
    const loop = (color: 'white' | 'pink' | 'brown', to: AudioNode) => {
      const buf = e.noiseBuffer(color);
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.connect(to);
      // разные места одного буфера — несвязанные слои (левый и правый ветер не совпадают)
      s.start(ctx.currentTime, rnd() * ((buf?.duration ?? 1) - 0.1));
      sources.push(s);
      return s;
    };
    const osc = (type: OscillatorType, f: number, to: AudioNode) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.connect(to);
      o.start(ctx.currentTime);
      sources.push(o);
      return o;
    };

    const out = gain(1, e.ambBus);

    // ---- Ветер: коричневый и розовый шум с двух сторон, полосы с блуждающим центром ----
    const windGain = gain(0, out);
    const far = gain(0, e.reverb);
    windGain.connect(far);
    const sides: WindSide[] = [-0.75, 0.75].map((pan) => {
      const gust = gain(0.7, panTo(ctx, windGain, pan));
      const band = filter('bandpass', 450, 0.8, gust);
      loop('brown', gain(1, band));
      loop('pink', gain(0.3, band));
      return { band, gust };
    });
    const whistleGain = gain(0, panTo(ctx, windGain, 0.35));
    const whistle = filter('bandpass', 900, 30, whistleGain);
    loop('pink', gain(0.6, whistle));

    // ---- Двигатель: f0/2f0/3f0 → насыщение → фильтр по режиму → пульсация → перебои ----
    const engineGain = gain(0, out);
    const stutter = gain(1, engineGain);
    const pulse = gain(0.9, stutter);
    // Основной тон 38–58 Гц динамик телефона не сыграет: срезаем его снизу и поднимаем гармоники
    // 150–400 Гц, по ним ухо достраивает гул («пропавшая фундаментальная»)
    const body = filter('peaking', 240, 0.9, pulse);
    body.gain.value = 6;
    const high = filter('highpass', 125, 0.8, body);
    const lowpass = filter('lowpass', 900, 0.9, high);
    const shaper = ctx.createWaveShaper();
    shaper.curve = saturation(3.4);
    shaper.oversample = '2x';
    shaper.connect(lowpass);
    const mix = gain(1, shaper);
    const oscs = HARMONICS.map(([k, amp]) => osc(k === 1 ? 'triangle' : 'sine', 46 * k, gain(amp, mix)));
    const lfoDepth = gain(0.1, pulse.gain);
    const lfo = osc('sine', 4.5, lfoDepth);
    const turbineGain = gain(0, gain(0.08, stutter));
    const turbine = osc('sine', 46 * 18, turbineGain);
    // лёгкое подвывание турбины
    osc('sine', 0.35, gain(6, turbine.detune));
    const flowGain = gain(0, stutter);
    loop('pink', gain(0.35, filter('bandpass', 900, 0.7, flowGain)));

    // ---- Мгла: розовый шум сверху, дыхание 0,15 Гц, шёпот формантами ----
    const mistGain = gain(0, out);
    const breath = gain(0.7, mistGain);
    osc('sine', 0.1 + rnd() * 0.1, gain(0.3, breath.gain));
    const open = filter('lowpass', 1500, 0.5, breath);
    const hp = filter('highpass', 300, 0.6, open);
    const merge = ctx.createChannelMerger(2);
    merge.connect(hp);
    // два места буфера в два канала — шорох со всех сторон, а не точкой
    const mistL = gain(0.8);
    const mistR = gain(0.8);
    mistL.connect(merge, 0, 0);
    mistR.connect(merge, 0, 1);
    loop('pink', mistL);
    loop('pink', mistR);
    const whisperGain = gain(0, mistGain);
    const syllable = gain(0.5, whisperGain);
    const formants = (VOWELS[0] as number[]).map((f) => filter('bandpass', f, 9, syllable));
    const whisperSrc = gain(1.4);
    for (const f of formants) whisperSrc.connect(f);
    loop('white', whisperSrc);

    const creak = gain(0, out);

    return {
      out,
      wind: { gain: windGain, far, sides, whistle, whistleGain },
      engine: {
        gain: engineGain,
        oscs,
        lowpass,
        pulse,
        lfo,
        lfoDepth,
        stutter,
        turbine,
        turbineGain,
        flowGain,
      },
      mist: { gain: mistGain, open, formants, whisperGain, syllable },
      creak,
      sources,
    };
  }
}

/** Кривая мягкого насыщения tanh: гармоники 100–400 Гц, чтобы гул слышал динамик телефона. */
export function saturation(drive: number, n = 1024): Float32Array<ArrayBuffer> {
  const c = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(drive * x) / norm;
  }
  return c;
}

/**
 * Скрип трения, пока нет файла: серия импульсов (пилообразная волна 15–45 Гц с «залипанием»)
 * через резонансные полосы — дерево ниже и глуше, металл выше и звонче.
 */
export function synthCreak(e: AudioEngine, t: number, dest: AudioNode, pan = 0, metal = false): void {
  const ctx = e.ctx;
  if (!ctx) return;
  const rnd = e.rnd;
  const dur = 0.45 + rnd() * 0.9;
  const end = t + dur + 0.25;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(1, t + 0.06 + rnd() * 0.1);
  env.gain.setValueAtTime(1, t + dur * 0.7);
  env.gain.exponentialRampToValueAtTime(0.0001, end);
  env.connect(panTo(ctx, dest, pan, t));
  const src = ctx.createOscillator();
  src.type = 'sawtooth';
  const f1 = 15 + rnd() * 12;
  src.frequency.setValueAtTime(f1, t);
  src.frequency.linearRampToValueAtTime(f1 * (1.6 + rnd()), t + dur * 0.5);
  src.frequency.linearRampToValueAtTime(f1 * (0.9 + rnd() * 0.6), t + dur);
  const bands = metal ? [1300, 2600, 4100] : [420, 980, 1900];
  const q = metal ? 28 : 14;
  for (const [i, f] of bands.entries()) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f * vary(rnd, 8);
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = (metal ? 1.4 : 2.2) / (i + 1);
    src.connect(bp).connect(g).connect(env);
  }
  src.start(t);
  src.stop(end + 0.02);
}

/** Пробный порыв ветра для ползунка «Атмосфера» в настройках. */
export function playGust(e: AudioEngine, delay = 0): void {
  const ctx = e.ctx;
  if (!ctx || !e.ready || !e.ambienceAudible) return;
  const t = ctx.currentTime + 0.01 + delay;
  const rnd = e.rnd;
  noise(e, {
    t,
    dur: 0.35,
    attack: 0.3,
    release: 0.7,
    gain: 0.5 * vary(rnd, 10),
    dest: e.ambBus,
    filter: 'bandpass',
    freq: 380,
    to: 700 * vary(rnd, 15),
    q: 1.2,
    color: 'brown',
    pan: rnd() * 1.2 - 0.6,
  });
}
