// Какие звуки вызвало изменение состояния игры. Чистая функция без Web Audio — проверяется тестом.
// Действия дня (стройка, снос, ярус, декрет, рычаг двигателя) и смена дня видны по разнице двух
// состояний из GameStore: так не нужно трогать каждое место в интерфейсе, где действие вызывается.
// Как звучит каждая причина — index.ts (простые — playSfx, составные — events.ts).
import type { GameState, Tier } from '../core';
import type { SfxName } from './sfx';

/** Причина звука: имя и подробности для сведения. */
export interface Cue {
  name: SfxName | 'calendar';
  /** Панорама −1…1: стройка и снос звучат с той стороны башни, где слот. */
  pan?: number;
  /** Номер сброшенного яруса (0 — Корень). */
  tier?: number;
  /** Рычаг двигателя: 1 — вверх (к набору высоты), −1 — вниз (к экономии). */
  dir?: 1 | -1;
}

/** Крайний слот звучит на столько левее или правее середины. */
export const SLOT_PAN = 0.35;
/** Порядок режимов на рычаге: экономия — внизу, набор высоты — вверху. */
const LEVER: Record<string, number> = { save: 0, hold: 1, climb: 2 };

const builtCount = (s: GameState) => s.tiers.reduce((n, t) => n + t.slots.filter(Boolean).length, 0);

/** Панорама слота `i` из `n`: 0, 1, 2 → −0,35, 0, +0,35. */
export function slotPan(i: number, n: number): number {
  if (n < 2) return 0;
  return Math.round(((i / (n - 1)) * 2 - 1) * SLOT_PAN * 100) / 100;
}

/** Первый слот, который изменился между состояниями (тот же ярус): [ярус, слот, слотов в ярусе]. */
function changedSlot(prev: GameState, next: GameState): [number, number, number] | null {
  const n = Math.min(prev.tiers.length, next.tiers.length);
  for (let t = 0; t < n; t++) {
    const a = prev.tiers[t]?.slots ?? [];
    const b = next.tiers[t]?.slots ?? [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return [t, i, b.length];
  }
  return null;
}

const sameTier = (a: Tier | undefined, b: Tier | undefined) =>
  !!a && !!b && (a === b || (a.kind === b.kind && a.slots.join() === b.slots.join()));

/** Какой ярус пропал: первый, с которого башни расходятся. */
function droppedTier(prev: GameState, next: GameState): number {
  for (let i = 0; i < next.tiers.length; i++) if (!sameTier(prev.tiers[i], next.tiers[i])) return i;
  return next.tiers.length;
}

/**
 * Звуки по переходу prev → next. `days` — длина календаря (balance.calendar.days): на последний день
 * листок красный (`calendarRed`). Смена дня (ночь) даёт только ярус и листок календаря.
 */
export function stateCues(prev: GameState, next: GameState, days = Infinity): Cue[] {
  if (prev === next) return [];
  // Новая партия или загрузка сохранения: журнал короче — состояние подменено целиком, молчим
  if (next.day < prev.day || next.log.length < prev.log.length) return [];
  const out: Cue[] = [];
  if (next.tiers.length < prev.tiers.length) out.push({ name: 'tierDrop', tier: droppedTier(prev, next) });
  else if (next.tiers.length > prev.tiers.length) out.push({ name: 'tierUp' });
  if (next.day !== prev.day) {
    out.push({ name: next.day >= days ? 'calendarRed' : 'calendar' });
    return out;
  }

  if (next.engineMode !== prev.engineMode)
    out.push({ name: 'lever', dir: (LEVER[next.engineMode] ?? 1) > (LEVER[prev.engineMode] ?? 1) ? 1 : -1 });
  if (!prev.building && next.building) out.push({ name: 'tierStart' });
  const before = builtCount(prev);
  const after = builtCount(next);
  const slot = next.tiers.length === prev.tiers.length ? changedSlot(prev, next) : null;
  const pan = slot ? slotPan(slot[1], slot[2]) : 0;
  if (after > before) out.push({ name: 'build', pan });
  else if (after < before && next.tiers.length === prev.tiers.length) out.push({ name: 'demolish', pan });
  if (next.decrees.length !== prev.decrees.length) out.push({ name: 'decree' });
  return out;
}
