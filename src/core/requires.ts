import { countBuildings } from './state';
import type { GameState, Range, Requires } from './types';

const inRange = (value: number, r: Range): boolean =>
  (r.min === undefined || value >= r.min) && (r.max === undefined || value <= r.max);

function rangesHold<K extends string>(
  ranges: Partial<Record<K, Range>> | undefined,
  values: Record<K, number>,
): boolean {
  if (!ranges) return true;
  for (const key of Object.keys(ranges) as K[]) {
    const r = ranges[key];
    if (r && !inRange(values[key], r)) return false;
  }
  return true;
}

/** Условие ТЗ 10.4: выполнены все указанные поля; `any` — достаточно одного вложенного условия. */
export function checkRequires(req: Requires | undefined, state: GameState): boolean {
  if (!req) return true;
  const flags = new Set(state.flags);
  if (req.flags?.some((f) => !flags.has(f))) return false;
  if (req.notFlags?.some((f) => flags.has(f))) return false;
  if (req.anyFlags && !req.anyFlags.some((f) => flags.has(f))) return false;
  if (req.minDay !== undefined && state.day < req.minDay) return false;
  if (req.maxDay !== undefined && state.day > req.maxDay) return false;
  if (!rangesHold(req.stats, state.stats)) return false;
  if (!rangesHold(req.factions, state.factions)) return false;
  if (!rangesHold(req.res, state.res)) return false;
  if (req.buildings) {
    for (const [id, min] of Object.entries(req.buildings)) {
      if (countBuildings(state, id) < min) return false;
    }
  }
  if (req.any && !req.any.some((sub) => checkRequires(sub, state))) return false;
  return true;
}
