// Ночной расчёт в фиксированном порядке ТЗ 4.5. Прогноз на ночь — тот же расчёт на копии
// состояния (forecastNight), поэтому прогноз всегда совпадает с результатом.
// Шаг 14 (очередь утра) собирается в events: после runNight вызывается buildMorningQueue.
import { nextRandom } from './rng';
import {
  addEffects,
  addFactions,
  cloneState,
  etherNeed,
  factionStance,
  isTierInMist,
  productionFactors,
  RES_KEYS,
  residentsByTier,
  STAT_KEYS,
  slotOutput,
  staffing,
  tierMiddle,
} from './tower';
import type { Effects, GameData, GameState, Res, Stats } from './types';

export type Defeat = 'fall' | 'overthrow';

/** Что случилось за ночь: для утреннего отчёта (ТЗ 3.1) и прогноза (ТЗ 3.1, «Вечер»). */
export interface NightReport {
  /** Выработка зданий за ночь по ресурсам и показателям (уже с учётом рабочих и Мглы). */
  produced: Effects;
  /** Здания без полного набора рабочих, `ярус:слот`. */
  understaffed: string[];
  foodEaten: number;
  foodShortage: boolean;
  etherNeed: number;
  etherBurned: number;
  /** Доля нехватки эфира 0–1 и потеря высоты из-за неё, м. */
  etherShortfall: number;
  shortfallAltitudeLoss: number;
  altitudeDelta: number;
  mistRise: number;
  /** Индексы ярусов в Мгле после ночи. */
  tiersInMist: number[];
  /** Ярусы, впервые ушедшие в Мглу этой ночью. */
  newlySubmerged: number[];
  /** Ярусы, заброшенные этой ночью. */
  abandoned: number[];
  homeless: number;
  deaths: number;
  theft: { food: number; mat: number };
  sabotage: boolean;
  /** Модификаторы, срок которых закончился этой ночью. */
  expiredModifiers: string[];
  /** Новый ярус достроен этой ночью. */
  tierBuilt: boolean;
  defeat: Defeat | null;
  /** Итоговые изменения ресурсов и показателей за ночь (после − до). */
  delta: { res: Res; stats: Stats; altitude: number; mist: number };
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Ночь: возвращает новое состояние (день +1) и отчёт. Исходное состояние не меняется.
 * Порядок шагов — ТЗ 4.5; номера шагов в комментариях.
 */
export function runNight(input: GameState, data: GameData): { state: GameState; report: NightReport } {
  const b = data.balance;
  const s = cloneState(input);
  const before = cloneState(input);

  // Состояние до ночи: от него считаются Мгла на ярусах, рабочие и фракционные пассивы.
  const inMistAtDusk = s.tiers.map((_, i) => isTierInMist(s, b, i));

  // 1. Модификаторы: отсроченные ждут, действующие дают эффект, истёкшие снимаются.
  const expiredModifiers: string[] = [];
  const kept: GameState['modifiers'] = [];
  for (const m of s.modifiers) {
    if (m.startInNights && m.startInNights > 0) {
      kept.push({ ...m, startInNights: m.startInNights - 1 });
      continue;
    }
    addEffects(s, m.perNight);
    addFactions(s, b, m.factionsPerNight);
    const left = m.left - 1;
    if (left > 0) kept.push({ ...m, left });
    else expiredModifiers.push(m.id);
  }

  // 2. Декреты.
  let foodFactor = 1;
  for (const id of s.decrees) {
    const d = b.decrees.list[id];
    if (!d) continue;
    addEffects(s, d.perNight);
    addFactions(s, b, d.factions);
    foodFactor *= d.foodFactor ?? 1;
  }

  // 3. Распределение рабочих (по жителям на начало ночи).
  const staff = staffing(input, b);
  const understaffed: string[] = [];

  // 4. Производство: слот за слотом (slotOutput — тот же расчёт показывает окно комнаты).
  const factors = productionFactors(input, b);
  const produced: Record<string, number> = {};
  s.tiers.forEach((tier, i) => {
    tier.slots.forEach((_slot, j) => {
      const out = slotOutput(s, b, i, j, { staff, factors, inMist: inMistAtDusk[i] });
      if (!out) return;
      if (out.staff && out.staff.have < out.staff.need) understaffed.push(`${i}:${j}`);
      for (const [k, v] of Object.entries(out.effects)) produced[k] = (produced[k] ?? 0) + v;
    });
  });
  for (const k of Object.keys(produced)) produced[k] = Math.round(produced[k] ?? 0);
  addEffects(s, produced);

  // 5. Еда.
  const foodEaten = Math.ceil(b.food.perPerson * s.res.pop * foodFactor);
  const foodShortage = s.res.food < foodEaten;
  if (foodShortage) {
    s.res.food = 0;
    addEffects(s, { health: b.food.shortageHealth, trust: b.food.shortageTrust });
  } else {
    s.res.food -= foodEaten;
  }

  // 6. Двигатель. Нужда — по состоянию до ночи (с модификаторами needPerNight, фракциями, Корнем в Мгле).
  const need = etherNeed(input, b);
  const mode = b.engine.modes[s.engineMode];
  const burnWanted = Math.max(0, Math.ceil(need * mode.burnFactor));
  const etherBurned = Math.min(burnWanted, s.res.ether);
  const etherShortfall = burnWanted > 0 ? (burnWanted - etherBurned) / burnWanted : 0;
  const shortfallAltitudeLoss = Math.ceil(b.engine.shortfallAltitudeLoss * etherShortfall);
  s.res.ether -= etherBurned;
  s.altitude += mode.altitude - shortfallAltitudeLoss;

  // 7. Мгла.
  const mistRise = round1(b.mist.risePerNight + b.mist.risePerEther * etherBurned);
  s.mist = round1(s.mist + mistRise);

  // 8. Ярусы в Мгле: счётчики, забрасывание обычных ярусов, штраф здоровью.
  const mistbornAlly = factionStance(input, b, 'mistborn') === 'ally';
  const tiersInMist: number[] = [];
  const newlySubmerged: number[] = [];
  const abandoned: number[] = [];
  s.tiers.forEach((tier, i) => {
    if (!isTierInMist(s, b, i)) {
      tier.mistNights = 0;
      return;
    }
    tiersInMist.push(i);
    const fresh = tier.mistNights === 0 && !inMistAtDusk[i];
    if (fresh) newlySubmerged.push(i);
    // Союз с Туманниками: первая ночь погружения не считается (ТЗ 4.6).
    if (!(fresh && mistbornAlly)) tier.mistNights += 1;
    if (tier.kind === 'tier' && !tier.abandoned && tier.mistNights >= b.tower.mistNightsToAbandon) {
      tier.abandoned = true;
      abandoned.push(i);
    }
  });
  addEffects(s, { health: b.tower.mistTierHealth * tiersInMist.length });

  // 9. Здоровье от бездомных.
  const { homeless } = residentsByTier(s, b);
  const homelessHit = Math.max(b.health.homelessCap, b.health.perTwoHomeless * Math.floor(homeless / 2));
  addEffects(s, { health: homelessHit });

  // 10. Ежедневный дрейф.
  addEffects(s, b.drift);

  // 11. Фракции: пассивы союза и вражды (стоимость эфира Кочегаров учтена в шаге 6, лазарет — в 4).
  let sabotage = false;
  if (factionStance(input, b, 'institute') === 'ally') {
    addEffects(s, { health: Number(b.factions.passive.institute.ally.health ?? 0) });
  }
  if (factionStance(input, b, 'mistborn') === 'enemy') {
    addEffects(s, { solidarity: Number(b.factions.passive.mistborn.enemy.solidarity ?? 0) });
  }
  const sky = factionStance(input, b, 'sky');
  if (sky === 'ally') addEffects(s, { solidarity: Number(b.factions.passive.sky.ally.solidarity ?? 0) });
  if (sky === 'enemy') {
    const [roll, next] = nextRandom(s.rng);
    s.rng = next;
    if (roll < Number(b.factions.passive.sky.enemy.sabotageChance ?? 0)) {
      sabotage = true;
      addEffects(s, { ether: Number(b.factions.passive.sky.enemy.sabotageEther ?? 0) });
    }
  }

  // 12. Пороги: смерти от болезней, кражи от беспорядка.
  const t = b.thresholds;
  let deaths = 0;
  if (s.stats.health < (t.healthDeaths ?? 0)) {
    deaths = Math.ceil(s.res.pop * (t.healthDeathShare ?? 0));
    s.res.pop -= deaths;
  }
  const theft = { food: 0, mat: 0 };
  if (s.stats.order < (t.orderTheft ?? 0)) {
    const share = t.orderTheftShare ?? 0;
    theft.food = Math.ceil(s.res.food * share);
    theft.mat = Math.ceil(s.res.mat * share);
    s.res.food -= theft.food;
    s.res.mat -= theft.mat;
  }

  // 13. Поражения: сначала «Падение» (Мгла выше середины Шпиля), затем «Свержение».
  let defeat: Defeat | null = null;
  if (s.mist > tierMiddle(s, b, s.tiers.length - 1)) defeat = 'fall';
  else if (s.stats.trust <= (t.trustLose ?? 0)) defeat = 'overthrow';
  if (defeat) s.ending = defeat;

  // Стройка яруса: ночь прошла, новый ярус встаёт под Шпилем, когда счётчик дошёл до нуля.
  let tierBuilt = false;
  s.modifiers = kept;
  if (s.building) {
    const nightsLeft = s.building.nightsLeft - 1;
    if (nightsLeft <= 0) {
      s.building = null;
      tierBuilt = true;
      s.tiers.splice(s.tiers.length - 1, 0, {
        kind: 'tier',
        slots: Array.from({ length: b.tower.slotsPerTier }, () => null),
        mistNights: 0,
        abandoned: false,
      });
    } else {
      s.building = { nightsLeft };
    }
  }

  s.day += 1;

  const delta = {
    res: Object.fromEntries(RES_KEYS.map((k) => [k, s.res[k] - before.res[k]])) as Res,
    stats: Object.fromEntries(STAT_KEYS.map((k) => [k, s.stats[k] - before.stats[k]])) as Stats,
    altitude: s.altitude - before.altitude,
    mist: round1(s.mist - before.mist),
  };

  return {
    state: s,
    report: {
      produced,
      understaffed,
      foodEaten,
      foodShortage,
      etherNeed: need,
      etherBurned,
      etherShortfall,
      shortfallAltitudeLoss,
      altitudeDelta: delta.altitude,
      mistRise,
      tiersInMist,
      newlySubmerged,
      abandoned,
      homeless,
      deaths,
      theft,
      sabotage,
      expiredModifiers,
      tierBuilt,
      defeat,
      delta,
    },
  };
}

/** Прогноз на ночь для вечерней панели: тот же расчёт, состояние игры не меняется. */
export function forecastNight(state: GameState, data: GameData): NightReport {
  return runNight(state, data).report;
}

/** Что не так с прогнозом — причины для красной кнопки «Завершить день» (ТЗ 3.1). */
export function forecastWarnings(report: NightReport): string[] {
  const out: string[] = [];
  if (report.defeat === 'fall') out.push('Мгла накроет Шпиль: башня падёт');
  if (report.defeat === 'overthrow') out.push('Доверие упадёт до нуля: Председателя свергнут');
  if (report.etherShortfall > 0) {
    out.push(`Не хватит эфира: башня просядет на ${report.shortfallAltitudeLoss} м`);
  }
  if (report.foodShortage) out.push('Не хватит еды: здоровье и доверие упадут');
  if (report.newlySubmerged.length) out.push('Ярус уйдёт в Мглу');
  if (report.abandoned.length) out.push('Ярус будет заброшен');
  if (report.deaths) out.push(`Умрут от болезней: ${report.deaths}`);
  return out;
}
