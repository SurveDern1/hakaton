// Детерминированный генератор (mulberry32). Состояние — одно число в GameState.rng,
// поэтому сохранение и повтор прогона дают те же случайные события.

export function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Следующее число в [0, 1) и новое состояние генератора. */
export function nextRandom(seed: number): [value: number, seed: number] {
  const next = (seed + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

/** Выбор по весам; возвращает индекс и новое состояние генератора. */
export function pickWeighted(seed: number, weights: number[]): [index: number, seed: number] {
  const total = weights.reduce((a, w) => a + w, 0);
  const [r, next] = nextRandom(seed);
  let x = r * total;
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i] ?? 0;
    if (x < 0) return [i, next];
  }
  return [weights.length - 1, next];
}
