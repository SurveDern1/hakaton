// Какие звуки вызвало изменение состояния игры. Чистая функция без Web Audio — проверяется тестом.
// Действия дня (стройка, снос, ярус, декрет) видны по разнице двух состояний из GameStore:
// так не нужно трогать каждое место в интерфейсе, где действие вызывается.
import type { GameState } from '../core';
import type { SfxName } from './sfx';

const builtCount = (s: GameState) => s.tiers.reduce((n, t) => n + t.slots.filter(Boolean).length, 0);

/** Звуки по переходу prev → next. Смена дня (ночь) и новая партия дают только звук яруса. */
export function stateCues(prev: GameState, next: GameState): SfxName[] {
  if (prev === next) return [];
  // Новая партия или загрузка сохранения: журнал короче — состояние подменено целиком, молчим
  if (next.day < prev.day || next.log.length < prev.log.length) return [];
  const out: SfxName[] = [];
  if (next.tiers.length < prev.tiers.length) out.push('tierDrop');
  else if (next.tiers.length > prev.tiers.length) out.push('tierUp');
  if (next.day !== prev.day) return out;

  if (!prev.building && next.building) out.push('tierStart');
  const before = builtCount(prev);
  const after = builtCount(next);
  if (after > before) out.push('build');
  else if (after < before && next.tiers.length === prev.tiers.length) out.push('demolish');
  if (next.decrees.length !== prev.decrees.length) out.push('decree');
  return out;
}
