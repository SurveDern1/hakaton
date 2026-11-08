// Метрики звука без ушей: чистые функции над Float32Array (каналы рендера AudioEngine.offline).
// Пик и RMS в дБFS, громкость в LUFS (BS.1770: K-взвешивание двумя биквадами, блоки 400 мс с шагом
// 100 мс, стробы −70 LUFS и −10 LU), щелчок на краях, хвост тишины, доля энергии выше 150 Гц (что
// останется на динамике телефона), корреляция каналов (ширина стерео), WAV для прослушивания.
// Пороги — LIMITS и checkMetrics; вызываются лабораторией (lab.ts) и `npm run check:sound`.

export type Channels = Float32Array[];

const dB = (v: number) => (v > 0 ? 20 * Math.log10(v) : -Infinity);

/** Пик по всем каналам, дБFS. */
export function peakDb(ch: Channels): number {
  let p = 0;
  for (const c of ch) for (let i = 0; i < c.length; i++) p = Math.max(p, Math.abs(c[i] as number));
  return dB(p);
}

/** Среднеквадратичный уровень по всем каналам за весь сигнал, дБFS. */
export function rmsDb(ch: Channels): number {
  let sum = 0;
  let n = 0;
  for (const c of ch) {
    for (let i = 0; i < c.length; i++) sum += (c[i] as number) ** 2;
    n += c.length;
  }
  return n ? 10 * Math.log10(sum / n || 0) : -Infinity;
}

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function biquad(x: Float32Array, f: Biquad): Float64Array {
  const y = new Float64Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i] as number;
    const y0 = f.b0 * x0 + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    y[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return y;
}

/** K-взвешивание BS.1770 для любой частоты дискретизации (коэффициенты как в libebur128). */
function kWeight(sr: number): [Biquad, Biquad] {
  let K = Math.tan((Math.PI * 1681.974450955533) / sr);
  const Vh = 10 ** (3.999843853973347 / 20);
  const Vb = Vh ** 0.4996667741545416;
  let Q = 0.7071752369554196;
  let a0 = 1 + K / Q + K * K;
  const shelf: Biquad = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  K = Math.tan((Math.PI * 38.13547087602444) / sr);
  Q = 0.5003270373238773;
  a0 = 1 + K / Q + K * K;
  const hp: Biquad = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  return [shelf, hp];
}

/** Фильтр высоких частот Баттерворта второго порядка (RBJ). */
function highpass(sr: number, f0: number): Biquad {
  const w = (2 * Math.PI * f0) / sr;
  const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
  const cos = Math.cos(w);
  const a0 = 1 + alpha;
  return {
    b0: (1 + cos) / 2 / a0,
    b1: -(1 + cos) / a0,
    b2: (1 + cos) / 2 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

/**
 * Интегральная громкость BS.1770-4, LUFS. Сигнал короче 400 мс меряется одним блоком целиком.
 * Тишина — −Infinity.
 */
export function lufs(ch: Channels, sr: number): number {
  const [shelf, hp] = kWeight(sr);
  const sq = ch.map((c) => {
    const y = biquad(Float32Array.from(biquad(c, shelf)), hp);
    // накопленная сумма квадратов: средний квадрат любого блока за O(1)
    const acc = new Float64Array(y.length + 1);
    for (let i = 0; i < y.length; i++) acc[i + 1] = (acc[i] as number) + (y[i] as number) ** 2;
    return acc;
  });
  const n = ch[0]?.length ?? 0;
  if (!n) return -Infinity;
  const block = Math.min(n, Math.round(0.4 * sr));
  const hop = Math.max(1, Math.round(0.1 * sr));
  const loud: number[] = [];
  for (let s = 0; s + block <= n; s += hop) {
    let z = 0;
    for (const acc of sq) z += ((acc[s + block] as number) - (acc[s] as number)) / block;
    loud.push(z);
  }
  const toL = (z: number) => -0.691 + 10 * Math.log10(z);
  const gate = (list: number[], thr: number) => list.filter((z) => z > 0 && toL(z) > thr);
  const abs = gate(loud, -70);
  if (!abs.length) return -Infinity;
  const mean = (l: number[]) => l.reduce((a, b) => a + b, 0) / l.length;
  const rel = gate(abs, toL(mean(abs)) - 10);
  return toL(mean(rel.length ? rel : abs));
}

/** Скачок на первом и последнем отсчёте (слышен как щелчок), дБFS. */
export function edgeDb(ch: Channels): number {
  let e = 0;
  for (const c of ch) {
    if (!c.length) continue;
    e = Math.max(e, Math.abs(c[0] as number), Math.abs(c[c.length - 1] as number));
  }
  return dB(e);
}

/** Пик последних `ms` миллисекунд: звук затих, узлы не висят. */
export function tailDb(ch: Channels, sr: number, ms = 100): number {
  const len = Math.round((sr * ms) / 1000);
  return peakDb(ch.map((c) => c.subarray(Math.max(0, c.length - len))));
}

/** Доля энергии выше `f0` Гц (по умолчанию 150): сколько звука останется на динамике телефона, 0..1. */
export function highShare(ch: Channels, sr: number, f0 = 150): number {
  const f = highpass(sr, f0);
  let all = 0;
  let high = 0;
  for (const c of ch) {
    const y = biquad(c, f);
    for (let i = 0; i < c.length; i++) {
      all += (c[i] as number) ** 2;
      high += (y[i] as number) ** 2;
    }
  }
  return all > 0 ? Math.min(1, high / all) : 0;
}

/** Корреляция левого и правого каналов: 1 — моно, 0 — независимые, −1 — противофаза. */
export function correlation(l: Float32Array, r: Float32Array): number {
  const n = Math.min(l.length, r.length);
  let sl = 0;
  let sr = 0;
  for (let i = 0; i < n; i++) {
    sl += l[i] as number;
    sr += r[i] as number;
  }
  const ml = sl / (n || 1);
  const mr = sr / (n || 1);
  let xy = 0;
  let xx = 0;
  let yy = 0;
  for (let i = 0; i < n; i++) {
    const a = (l[i] as number) - ml;
    const b = (r[i] as number) - mr;
    xy += a * b;
    xx += a * a;
    yy += b * b;
  }
  return xx > 0 && yy > 0 ? xy / Math.sqrt(xx * yy) : 1;
}

/** До какой секунды звук слышен (последний отсчёт громче −60 дБFS). */
export function activeSec(ch: Channels, sr: number, floorDb = -60): number {
  const floor = 10 ** (floorDb / 20);
  let last = 0;
  for (const c of ch)
    for (let i = c.length - 1; i > last; i--)
      if (Math.abs(c[i] as number) > floor) {
        last = i;
        break;
      }
  return last / sr;
}

export interface SoundMetrics {
  /** Пик суммы шин до ограничителя, дБFS. */
  peak: number;
  /** Пик на выходе после ограничителя, дБFS. */
  peakPost: number;
  rms: number;
  lufs: number;
  edge: number;
  tail: number;
  /** Доля энергии выше 150 Гц, 0..1. */
  high: number;
  corr: number;
  /** Слышимая длина, с. */
  length: number;
}

/**
 * Ослабление ограничителем, дБ (≥ 0): по окнам `winMs` сравнивается громкость до и после него.
 * Без ослабления выход = вход × `makeupDb` (автоматическая компенсация Chrome, меряется отдельно
 * тихим тоном — AudioEngine.makeupDb); всё, что ниже этого, — работа ограничителя. Вход сдвинут на
 * `delayMs` — упреждение ограничителя (в Chrome 6 мс). Окна тише `floorDb` не учитываются; первые
 * `skipMs` — тоже: в начале рендера ограничитель Chrome ещё выходит из начального состояния.
 */
export function limiterReduction(
  pre: Channels,
  post: Channels,
  sr: number,
  makeupDb: number,
  opts: { winMs?: number; delayMs?: number; floorDb?: number; skipMs?: number } = {},
): number {
  const win = Math.max(1, Math.round(((opts.winMs ?? 20) / 1000) * sr));
  const delay = Math.round(((opts.delayMs ?? 6) / 1000) * sr);
  const floor = 10 ** ((opts.floorDb ?? -50) / 10);
  const n = Math.min(pre[0]?.length ?? 0, post[0]?.length ?? 0);
  const power = (ch: Channels, a: number) => {
    let s = 0;
    for (const c of ch) for (let i = a; i < a + win; i++) s += (c[i] as number) ** 2;
    return s / (win * ch.length);
  };
  let worst = 0;
  for (let a = Math.round(((opts.skipMs ?? 0) / 1000) * sr); a + win + delay <= n; a += win) {
    const p = power(pre, a);
    if (p < floor) continue;
    const g = 10 * Math.log10(power(post, a + delay) / p);
    worst = Math.max(worst, makeupDb - g);
  }
  return worst;
}

/** Все метрики рендера: `pre` — сумма шин до ограничителя, `post` — то, что слышно. */
export function measureChannels(pre: Channels, post: Channels, sr: number): SoundMetrics {
  return {
    peak: peakDb(pre),
    peakPost: peakDb(post),
    rms: rmsDb(post),
    lufs: lufs(post, sr),
    edge: edgeDb(post),
    tail: tailDb(post, sr),
    high: highShare(post, sr),
    corr: correlation(post[0] ?? new Float32Array(), post[1] ?? new Float32Array()),
    length: activeSec(post, sr),
  };
}

/** Пороги раздела «Проверка» плана звука (docs/plans/sound.md). */
export const LIMITS = {
  /** Пик каждого звука до ограничителя, дБFS. */
  peak: -1,
  /** Сумма после ограничителя, дБFS. */
  peakPost: -0.5,
  /** Скачок на краях, дБFS. */
  edge: -60,
  /** Хвост тишины, дБFS. */
  tail: -60,
};

/**
 * Нарушения порогов. `oneshot` — короткий звук: проверяются края и хвост. `loop` — фон или тема,
 * обрезанные посреди звучания: только пики и что звук вообще слышен.
 */
export function checkMetrics(m: SoundMetrics, kind: 'oneshot' | 'loop'): string[] {
  const errs: string[] = [];
  const f = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : String(v));
  if (m.peak > LIMITS.peak) errs.push(`пик ${f(m.peak)} дБFS > ${LIMITS.peak}`);
  if (m.peakPost > LIMITS.peakPost)
    errs.push(`пик после ограничителя ${f(m.peakPost)} дБFS > ${LIMITS.peakPost}`);
  if (!Number.isFinite(m.lufs)) errs.push('тишина: звук не прозвучал');
  if (kind === 'oneshot') {
    if (m.edge > LIMITS.edge) errs.push(`щелчок на краю ${f(m.edge)} дБFS > ${LIMITS.edge}`);
    if (m.tail > LIMITS.tail) errs.push(`хвост ${f(m.tail)} дБFS > ${LIMITS.tail}: звук не затих`);
  }
  return errs;
}

/**
 * Обрезка для набора WAV: короткий звук — до затухания (`activeSec`) плюс `tailSec`, тема и фон — не
 * длиннее `maxSec`; в конце — затухание 20 мс, чтобы обрезка не щёлкала.
 */
export function trimForListening(
  ch: Channels,
  sr: number,
  kind: 'oneshot' | 'loop',
  opts: { tailSec?: number; maxSec?: number } = {},
): Channels {
  const n = ch[0]?.length ?? 0;
  const want = kind === 'oneshot' ? activeSec(ch, sr) + (opts.tailSec ?? 0.3) : (opts.maxSec ?? 10);
  const len = Math.min(n, Math.max(1, Math.ceil(want * sr)));
  const fade = Math.min(len, Math.round(0.02 * sr));
  return ch.map((c) => {
    const out = c.slice(0, len);
    if (len < n) for (let i = 0; i < fade; i++) out[len - 1 - i] = (out[len - 1 - i] as number) * (i / fade);
    return out;
  });
}

/** WAV 16 бит из каналов (для прослушивания набора на телефоне и в наушниках). */
export function encodeWav(ch: Channels, sr: number): Uint8Array<ArrayBuffer> {
  const n = ch[0]?.length ?? 0;
  const k = ch.length;
  const data = n * k * 2;
  const buf = new ArrayBuffer(44 + data);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + data, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, k, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * k * 2, true);
  v.setUint16(32, k * 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, data, true);
  let o = 44;
  for (let i = 0; i < n; i++)
    for (const c of ch) {
      const s = Math.max(-1, Math.min(1, c[i] as number));
      v.setInt16(o, Math.round(s * 32767), true);
      o += 2;
    }
  return new Uint8Array(buf);
}
