// Кирпичики синтеза для звуков и музыки: тон с огибающей и фильтром, полоса шума, орган из гармоник.
// Каждый вызов создаёт свои узлы и сам их останавливает; ничего не держится после затухания.
import type { AudioEngine } from './audio';

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
  g.connect(o.dest);
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
}

/** Полоса шума: шелест, удар, ветер, обвал. */
export function noise(e: AudioEngine, o: NoiseOpts): void {
  const ctx = e.ctx;
  const buf = e.noiseBuffer();
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
  src.connect(f).connect(g).connect(o.dest);
  if (o.send) {
    const s = ctx.createGain();
    s.gain.value = o.send;
    g.connect(s).connect(e.reverb);
  }
  // разные места буфера — разные «зёрна» шума у соседних ударов
  src.start(o.t, (o.t * 7.31) % 1.9);
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
