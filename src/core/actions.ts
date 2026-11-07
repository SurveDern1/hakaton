// Действия игрока днём (ТЗ 3.1 «День», 5.1, 5.2, 6.6): цены списываются сразу.
// Каждое действие — чистая функция; при отказе состояние не меняется и есть причина для интерфейса.

import { countBuildings } from './state';
import { cloneState, newTierCost, residentsByTier } from './tower';
import type { EngineMode, GameData, GameState } from './types';

export type ActionResult = { ok: true; state: GameState } | { ok: false; reason: string };

const fail = (reason: string): ActionResult => ({ ok: false, reason });

/** Почему здание нельзя поставить в этот слот; null — можно. */
export function buildBlocker(
  state: GameState,
  data: GameData,
  tierIndex: number,
  slot: number,
  buildingId: string,
): string | null {
  const b = data.balance;
  const tier = state.tiers[tierIndex];
  const def = b.buildings[buildingId];
  if (!tier || slot < 0 || slot >= tier.slots.length) return 'Нет такого места';
  if (!def) return 'Нет такого здания';
  if (state.ending) return 'Игра окончена';
  if (tier.abandoned) return 'Ярус заброшен';
  if (tier.slots[slot]) return 'Место занято';
  if (def.fixed || def.afterMvp) return 'Это здание не строится';
  if (def.locked && !state.unlocked.includes(buildingId)) return 'Ещё не открыто';
  if (def.tiers && !def.tiers.includes(tier.kind)) return 'Не подходит для этого яруса';
  if (def.allowed === 'rootAndAbove' && tierIndex > 1) return 'Только в Корне и ярусе над ним';
  if (def.maxCount !== undefined && countBuildings(state, buildingId) >= def.maxCount) return 'Уже построено';
  if (
    state.modifiers.some(
      (m) => m.lockBuild?.includes(buildingId) && !(m.startInNights && m.startInNights > 0),
    )
  ) {
    return 'Сейчас запрещено';
  }
  if (state.res.mat < (def.cost ?? 0)) return `Нужно ${def.cost} материалов`;
  return null;
}

export function build(
  state: GameState,
  data: GameData,
  tierIndex: number,
  slot: number,
  buildingId: string,
): ActionResult {
  const blocker = buildBlocker(state, data, tierIndex, slot, buildingId);
  if (blocker) return fail(blocker);
  const s = cloneState(state);
  const tier = s.tiers[tierIndex];
  if (!tier) return fail('Нет такого места');
  tier.slots[slot] = buildingId;
  s.res.mat -= data.balance.buildings[buildingId]?.cost ?? 0;
  return { ok: true, state: s };
}

/** Снос: бесплатно, возвращает долю материалов (balance.demolishRefund). */
export function demolish(state: GameState, data: GameData, tierIndex: number, slot: number): ActionResult {
  const id = state.tiers[tierIndex]?.slots[slot];
  if (!id) return fail('Здесь ничего нет');
  const def = data.balance.buildings[id];
  if (def?.fixed) return fail('Это здание не сносится');
  const s = cloneState(state);
  const tier = s.tiers[tierIndex];
  if (!tier) return fail('Нет такого места');
  tier.slots[slot] = null;
  s.res.mat += Math.floor((def?.cost ?? 0) * data.balance.demolishRefund);
  return { ok: true, state: s };
}

/** Заложить новый ярус под Шпилем: встаёт через balance.tower.newTier.nights ночей. */
export function startNewTier(state: GameState, data: GameData): ActionResult {
  const b = data.balance;
  if (state.building) return fail('Ярус уже строится');
  if (state.tiers.length >= b.tower.maxTiers) return fail('Башня выше не станет');
  const cost = newTierCost(state, b);
  if (state.res.mat < cost) return fail(`Нужно ${cost} материалов`);
  const s = cloneState(state);
  s.res.mat -= cost;
  s.building = { nightsLeft: b.tower.newTier.nights };
  return { ok: true, state: s };
}

/** Сколько погибнет при сбросе яруса: занятые места жилья, у брошенного — никто. */
export function dropTierVictims(state: GameState, data: GameData, tierIndex: number): number {
  if (state.tiers[tierIndex]?.abandoned) return 0;
  return residentsByTier(state, data.balance).byTier[tierIndex] ?? 0;
}

/** Сбросить обычный ярус: вес уходит, жители яруса гибнут, остаётся шрам (ТЗ 5.1). */
export function dropTier(state: GameState, data: GameData, tierIndex: number): ActionResult {
  const tier = state.tiers[tierIndex];
  if (!tier) return fail('Нет такого яруса');
  if (tier.kind !== 'tier') return fail('Корень и Шпиль не сбрасываются');
  const victims = dropTierVictims(state, data, tierIndex);
  const s = cloneState(state);
  s.tiers.splice(tierIndex, 1);
  s.res.pop -= victims;
  if (victims > 0) {
    const hit = data.balance.tower.dropTier.solidarityPerTierWithPeople;
    s.stats.solidarity = Math.max(0, Math.min(100, s.stats.solidarity + hit));
  }
  s.scars.push('stump');
  return { ok: true, state: s };
}

export function setEngineMode(state: GameState, mode: EngineMode): GameState {
  return { ...state, engineMode: mode };
}

/** Почему декрет нельзя включить; null — можно. */
export function decreeBlocker(state: GameState, data: GameData, id: string): string | null {
  const d = data.balance.decrees;
  const def = d.list[id];
  if (!def) return 'Нет такого декрета';
  if (state.decrees.includes(id)) return null;
  if (state.day < def.fromDay) return `Откроется в день ${def.fromDay}`;
  if (state.decrees.length >= d.maxActive) return `Не больше ${d.maxActive} декретов`;
  const until = state.decreeCooldown[id];
  if (until !== undefined && state.day < until) return `Можно снова с дня ${until}`;
  return null;
}

/** Включить или выключить декрет; выключенный нельзя включить decrees.cooldownDays дней (ТЗ 6.6). */
export function toggleDecree(state: GameState, data: GameData, id: string): ActionResult {
  if (state.decrees.includes(id)) {
    return {
      ok: true,
      state: {
        ...state,
        decrees: state.decrees.filter((x) => x !== id),
        decreeCooldown: { ...state.decreeCooldown, [id]: state.day + data.balance.decrees.cooldownDays },
      },
    };
  }
  const blocker = decreeBlocker(state, data, id);
  if (blocker) return fail(blocker);
  return { ok: true, state: { ...state, decrees: [...state.decrees, id] } };
}
