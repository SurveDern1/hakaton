// Кирпичики синтеза для звуков и музыки: тон с огибающей и фильтром, полоса шума (белый, розовый,
// коричневый), орган из гармоник, панорама и вариации повторов.
// Каждый вызов создаёт свои узлы и сам их останавливает; ничего не держится после затухания.
import type { AudioEngine, NoiseColor } from './audio';

/**
 * Вариация повтора: множитель 1 ± pct % (равномерно). `rnd` — генератор звука (engine.rnd или свой
 * makeRandom), не игровой: так щелчки и удары каждый раз звучат чуть иначе.
 */
export function vary(rnd: () => number, pct: number): number {
  return 1 + (rnd() * 2 - 1) * (pct / 100);
}

/** Вариация громкости в децибелах: множитель 10^(±db/20). */
export function varyDb(rnd: () => number, db: number): number {
  return 10 ** (((rnd() * 2 - 1) * db) / 20);
}

/**
 * Узел панорамы −1 (слева) … 1 (справа) перед `dest`; без панорамы или без StereoPannerNode (старый
 * Safari) — сам `dest`. Возвращает, куда подключать звук.
 */
export function panTo(ctx: BaseAudioContext, dest: AudioNode, pan: number | undefined, t = 0): AudioNode {
  if (!pan || typeof ctx.createStereoPanner !== 'function') return dest;
  const p = ctx.createStereoPanner();
  p.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), t);
  p.connect(dest);
  return p;
}

export interface ToneOpts {
  freq: number;
  /** Скольжение частоты к значению к концу звука (падение, свист). */
  to?: number;
  type?: OscillatorType;
  t: number;
  dur: number;
  attack?: number;
  release?: number;
  gain: number;
  dest: AudioNode;
  /** Фильтр низких частот: срез в начале и (если задан) к концу. */
  filter?: number;
  filterTo?: number;
  q?: number;
  /** Второй осциллятор с расстройкой в центах — «хоровой» объём духовых. */
  detune?: number;
  /** Вибрато: глубина в центах и частота в Гц. */
  vibrato?: [number, number];
  /** Доля сигнала в реверберацию. */
  send?: number;
  /** Панорама −1 … 1 (реверберация остаётся общей, по центру). */
  pan?: number;
}

/** Тон с огибающей ADSR без сустейна: атака → плато до dur → спад release. */
export function tone(e: AudioEngine, o: ToneOpts): void {
  const ctx = e.ctx;
  if (!ctx) return;
  const attack = o.attack ?? 0.01;
  const release = o.release ?? 0.1;
  const end = o.t + o.dur + release;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, o.t);
  g.gain.linearRampToValueAtTime(o.gain, o.t + attack);
  g.gain.setValueAtTime(o.gain, o.t + Math.max(attack, o.dur));
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  let head: AudioNode = g;
  if (o.filter) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = o.q ?? 0.7;
    f.frequency.setValueAtTime(o.filter, o.t);
    if (o.filterTo) f.frequency.exponentialRampToValueAtTime(o.filterTo, o.t + o.dur + release * 0.5);
    f.connect(g);
    head = f;
  }
  const oscs = [0, ...(o.detune ? [o.detune] : [])].map((cents) => {
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, o.t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, o.t + o.dur + release * 0.5);
    osc.detune.value = cents;
    osc.connect(head);
    return osc;
  });
  if (o.vibrato) {
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = o.vibrato[1];
    depth.gain.setValueAtTime(0, o.t);
    // вибрато вступает не сразу, как у живого духовика
    depth.gain.linearRampToValueAtTime(o.vibrato[0], o.t + Math.min(0.4, o.dur));
    lfo.connect(depth);
    for (const osc of oscs) depth.connect(osc.detune);
    lfo.start(o.t);
    lfo.stop(end);
  }
  g.connect(panTo(ctx, o.dest, o.pan, o.t));
  if (o.send) {
    const s = ctx.createGain();
    s.gain.value = o.send;
    g.connect(s).connect(e.reverb);
  }
  for (const osc of oscs) {
    osc.start(o.t);
    osc.stop(end + 0.02);
  }
}

export interface NoiseOpts {
  t: number;
  dur: number;
  attack?: number;
  release?: number;
  gain: number;
  dest: AudioNode;
  filter: BiquadFilterType;
  freq: number;
  to?: number;
  q?: number;
  send?: number;
  pan?: number;
  /** Цвет шума, по умолчанию белый. */
  color?: NoiseColor;
}

/** Полоса шума: шелест, удар, ветер, обвал. */
export function noise(e: AudioEngine, o: NoiseOpts): void {
  const ctx = e.ctx;
  const buf = e.noiseBuffer(o.color);
  if (!ctx || !buf) return;
  const attack = o.attack ?? 0.005;
  const release = o.release ?? 0.1;
  const end = o.t + o.dur + release;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = o.filter;
  f.Q.value = o.q ?? 1;
  f.frequency.setValueAtTime(o.freq, o.t);
  if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, o.t + o.dur + release * 0.5);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, o.t);
  g.gain.linearRampToValueAtTime(o.gain, o.t + attack);
  g.gain.setValueAtTime(o.gain, o.t + Math.max(attack, o.dur));
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  src
    .connect(f)
    .connect(g)
    .connect(panTo(ctx, o.dest, o.pan, o.t));
  if (o.send) {
    const s = ctx.createGain();
    s.gain.value = o.send;
    g.connect(s).connect(e.reverb);
  }
  // разные места буфера — разные «зёрна» шума у соседних ударов
  src.start(o.t, (o.t * 7.31) % (buf.duration - 0.1));
  src.stop(end + 0.02);
}

/** Органная труба: гармоники 1, 2, 3, 4 с убывающей громкостью и медленной атакой. */
export function organ(
  e: AudioEngine,
  freq: number,
  t: number,
  dur: number,
  gain: number,
  dest: AudioNode,
  send = 0.4,
) {
  const partials: [number, number][] = [
    [1, 1],
    [2, 0.45],
    [3, 0.22],
    [4, 0.12],
  ];
  for (const [mul, amp] of partials) {
    tone(e, { freq: freq * mul, t, dur, attack: 0.18, release: 0.6, gain: gain * amp, dest, send });
  }
}

/** Колокол: неровные обертоны с долгим затуханием. */
export function bell(e: AudioEngine, freq: number, t: number, gain: number, dest: AudioNode, send = 0.6) {
  const partials: [number, number, number][] = [
    [0.5, 0.5, 2.6],
    [1, 1, 2.2],
    [1.19, 0.45, 1.6],
    [1.56, 0.35, 1.2],
    [2.0, 0.3, 1.0],
    [2.74, 0.18, 0.7],
  ];
  for (const [mul, amp, len] of partials) {
    tone(e, { freq: freq * mul, t, dur: 0.01, attack: 0.004, release: len, gain: gain * amp, dest, send });
  }
}

/**
 * Удар, слышный на телефоне: щелчок атаки и тело `body` Гц (150–400 Гц), низ под ним — для наушников.
 * `long` — длина тела, с.
 */
export function thump(
  e: AudioEngine,
  t: number,
  out: AudioNode,
  gain: number,
  body: number,
  long = 0.16,
): void {
  noise(e, {
    t,
    dur: 0.004,
    release: 0.02,
    gain: gain * 0.7,
    dest: out,
    filter: 'bandpass',
    freq: 3000,
    q: 1.2,
  });
  tone(e, {
    type: 'triangle',
    freq: body * 1.4,
    to: body,
    t,
    dur: 0.012,
    release: long,
    gain,
    dest: out,
    send: 0.2,
  });
  noise(e, {
    t,
    dur: 0.02,
    release: long * 0.8,
    gain: gain * 0.5,
    dest: out,
    filter: 'bandpass',
    freq: body * 1.2,
    q: 1.5,
  });
}
