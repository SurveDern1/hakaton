// Расчёты по башне, общие для ночи, прогноза и действий дня (ТЗ 4.3, 4.4, 5.1).
import type { Balance, Effects, FactionKey, GameState, Res, StatKey } from './types';

export const STAT_KEYS: StatKey[] = ['trust', 'solidarity', 'health', 'order'];
export const RES_KEYS: (keyof Res)[] = ['pop', 'food', 'ether', 'mat'];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Прибавить эффекты к состоянию с ограничениями: показатели 0–100, ресурсы ≥ 0. Меняет state. */
export function addEffects(state: GameState, effects: Effects | undefined, factor = 1): void {
  if (!effects) return;
  for (const [key, raw] of Object.entries(effects)) {
    const v = (raw ?? 0) * factor;
    if (key === 'altitude') state.altitude += v;
    else if (key === 'mist') state.mist += v;
    else if ((STAT_KEYS as string[]).includes(key)) {
      const k = key as StatKey;
      state.stats[k] = clamp(state.stats[k] + v, 0, 100);
    } else {
      const k = key as keyof Res;
      state.res[k] = Math.max(0, state.res[k] + v);
    }
  }
}

export function addFactions(
  state: GameState,
  balance: Balance,
  delta: Partial<Record<FactionKey, number>> | undefined,
): void {
  if (!delta) return;
  const [lo, hi] = balance.factions.range;
  for (const [k, v] of Object.entries(delta) as [FactionKey, number][]) {
    state.factions[k] = clamp(state.factions[k] + v, lo, hi);
  }
}

/** Отношение фракции: союз, вражда или нейтралитет (ТЗ 4.6). */
export function factionStance(state: GameState, balance: Balance, f: FactionKey): 'ally' | 'enemy' | null {
  const v = state.factions[f];
  if (v >= balance.factions.allyAt) return 'ally';
  if (v <= balance.factions.enemyAt) return 'enemy';
  return null;
}

/** Середина яруса i (снизу, с 0) в метрах. */
export function tierMiddle(state: GameState, balance: Balance, i: number): number {
  const h = balance.tower.tierHeight;
  return state.altitude + h * i + h / 2;
}

/** Ярус в Мгле: Мгла выше его середины. */
export function isTierInMist(state: GameState, balance: Balance, i: number): boolean {
  return state.mist > tierMiddle(state, balance, i);
}

/** Мест жилья по ярусам: встроенные у Корня и Шпиля плюс жилые модули. Брошенный ярус — 0. */
export function housingByTier(state: GameState, balance: Balance): number[] {
  return state.tiers.map((t) => {
    if (t.abandoned) return 0;
    let places = balance.tower.builtInHousing[t.kind] ?? 0;
    for (const slot of t.slots) if (slot) places += balance.buildings[slot]?.housing ?? 0;
    return places;
  });
}

/** Сколько жителей живёт в каждом ярусе: заселение снизу вверх, остальные — бездомные. */
export function residentsByTier(state: GameState, balance: Balance): { byTier: number[]; homeless: number } {
  let left = state.res.pop;
  const byTier = housingByTier(state, balance).map((places) => {
    const n = Math.min(places, left);
    left -= n;
    return n;
  });
  return { byTier, homeless: left };
}

/** Рабочие по зданиям: снизу вверх, по слотам слева направо. Ключ — `ярус:слот`. */
export function staffing(state: GameState, balance: Balance): Map<string, { have: number; need: number }> {
  let left = state.res.pop;
  const out = new Map<string, { have: number; need: number }>();
  state.tiers.forEach((t, i) => {
    if (t.abandoned) return;
    t.slots.forEach((slot, j) => {
      const need = slot ? (balance.buildings[slot]?.workers ?? 0) : 0;
      if (!slot || need <= 0) return;
      const have = Math.min(need, left);
      left -= have;
      out.set(`${i}:${j}`, { have, need });
    });
  });
  return out;
}

/** Активные модификаторы ночи (отсрочка `startInNights` уже прошла). */
function liveModifiers(state: GameState) {
  return state.modifiers.filter((m) => !m.startInNights || m.startInNights <= 0);
}

/** Нужный эфир на ночь: need = база + за ярусы + за жителей, плюс фракции, модификаторы и Корень в Мгле. */
export function etherNeed(state: GameState, balance: Balance): number {
  const n = balance.engine.need;
  let need = n.base + n.perTier * state.tiers.length + n.perTenPop * Math.ceil(state.res.pop / 10);
  for (const m of liveModifiers(state)) need += m.needPerNight ?? 0;
  const stokers = factionStance(state, balance, 'stokers');
  if (stokers) need += Number(balance.factions.passive.stokers[stokers].need ?? 0);
  if (isTierInMist(state, balance, 0)) need = Math.ceil(need * balance.tower.rootInMistNeedFactor);
  return Math.max(0, need);
}

/** Сколько эфира сожжёт двигатель в текущем режиме, без учёта нехватки. */
export function etherBurn(state: GameState, balance: Balance): number {
  return Math.ceil(etherNeed(state, balance) * balance.engine.modes[state.engineMode].burnFactor);
}

/** Цена нового яруса: база + за каждый ярус сверх трёх. */
export function newTierCost(state: GameState, balance: Balance): number {
  const t = balance.tower.newTier;
  return t.baseCost + t.costPerExtraTier * Math.max(0, state.tiers.length - 3);
}

/** Глубокая копия состояния: состояние — обычный JSON. */
export function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

/** Свободные руки: жители минус рабочие всех зданий в живых ярусах (не меньше нуля). */
export function freeWorkers(state: GameState, balance: Balance): number {
  let busy = 0;
  for (const st of staffing(state, balance).values()) busy += st.have;
  return Math.max(0, state.res.pop - busy);
}
