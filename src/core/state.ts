import { seedFrom } from './rng';
import type { Balance, GameState } from './types';

/** Стартовое состояние из balance.start (ТЗ 4.7). */
export function createInitialState(balance: Balance, seed: number | string = Date.now()): GameState {
  const s = balance.start;
  return {
    day: 1,
    rng: typeof seed === 'string' ? seedFrom(seed) : seed >>> 0,
    res: { ...s.res },
    stats: { ...s.stats },
    factions: { ...s.factions },
    altitude: s.altitude,
    mist: s.mist,
    engineMode: s.engineMode,
    tiers: s.tiers.map((t) => ({ kind: t.kind, slots: [...t.slots], mistNights: 0, abandoned: false })),
    building: null,
    decrees: [],
    decreeCooldown: {},
    modifiers: [],
    flags: [],
    scheduled: [],
    seen: {},
    log: [],
    scars: [],
    unlocked: [],
    memories: 0,
    ending: null,
  };
}

/** Сколько зданий данного типа стоит в живых (не брошенных) ярусах. */
export function countBuildings(state: GameState, id: string): number {
  let n = 0;
  for (const t of state.tiers) {
    if (t.abandoned) continue;
    for (const slot of t.slots) if (slot === id) n++;
  }
  return n;
}
