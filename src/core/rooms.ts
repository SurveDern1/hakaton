// Взгляд в комнату (здание в слоте башни) и обход Председателя.
// roomInfo собирает всё, что видно внутри: сколько людей, сколько здание даст за ночь и почему
// меньше (тот же slotOutput, что в ночном расчёте), настроение по показателям и прогнозу ночи,
// реплику жителя из data/rooms.json. visitRoom — раз в день зайти в одну комнату: эффект из
// balance.rooms.visit сразу, запись в журнал.
import type { ActionResult } from './actions';
import { forecastNight } from './night';
import { checkRequires } from './requires';
import {
  addEffects,
  cloneState,
  isTierInMist,
  productionFactors,
  residentsByTier,
  slotOutput,
  staffing,
} from './tower';
import type { Effects, GameData, GameState, RoomLine, RoomMood } from './types';

/** Настроения от важного к фону: первое с репликой даёт голос комнаты. */
export const ROOM_MOODS: readonly RoomMood[] = [
  'mist',
  'frost',
  'dark',
  'hungry',
  'sick',
  'unrest',
  'rumors',
  'quarrel',
  'empty',
  'short',
  'crowded',
  'festive',
  'calm',
];

/** Почему здание даст меньше (или больше) своей нормы: множитель и его источник. */
export interface RoomReason {
  kind: 'staff' | 'mist' | 'decree' | 'root' | 'institute';
  factor: number;
}

export interface RoomInfo {
  tier: number;
  slot: number;
  /** id здания из balance.buildings. */
  id: string;
  name: string;
  fixed: boolean;
  /** Стадия здания: пока улучшений нет, у встроенных — мастерская. */
  stage: 1 | 2 | 3;
  abandoned: boolean;
  /** Рабочие: сколько есть из нужных; null — здание без рабочих. */
  workers: { have: number; need: number } | null;
  /** Жилой модуль: сколько живёт из мест. */
  residents: { live: number; places: number } | null;
  /** Выработка за ночь (округлена, как в отчёте) и из чего сложилась. */
  output: { effects: Record<string, number>; base: Effects; reasons: RoomReason[] } | null;
  moods: RoomMood[];
  line: RoomLine | null;
  visit: {
    /** Что даст обход этой комнаты. */
    effects: Effects;
    /** Почему зайти нельзя; null — можно. */
    blocker: string | null;
    /** Сегодня уже заходили именно сюда. */
    here: boolean;
  };
}

/** Комната в слоте; null — слот пуст или его нет. */
export function roomInfo(state: GameState, data: GameData, tier: number, slot: number): RoomInfo | null {
  const b = data.balance;
  const t = state.tiers[tier];
  const id = t?.slots[slot];
  if (!t || !id) return null;
  const def = b.buildings[id];
  const staff = staffing(state, b).get(`${tier}:${slot}`) ?? null;

  let residents: RoomInfo['residents'] = null;
  const places = def?.housing ?? 0;
  if (places > 0) {
    // Ярус заселяется сначала во встроенные места, потом в модули слева направо
    const live = residentsByTier(state, b).byTier[tier] ?? 0;
    let before = t.abandoned ? 0 : (b.tower.builtInHousing[t.kind] ?? 0);
    for (let j = 0; j < slot; j++) before += b.buildings[t.slots[j] ?? '']?.housing ?? 0;
    residents = { live: Math.max(0, Math.min(places, live - before)), places };
  }

  const out = slotOutput(state, b, tier, slot);
  let output: RoomInfo['output'] = null;
  if (out) {
    const reasons: RoomReason[] = [];
    if (out.staff && out.staff.have < out.staff.need)
      reasons.push({ kind: 'staff', factor: out.staff.have / out.staff.need });
    if (out.inMist) reasons.push({ kind: 'mist', factor: b.tower.mistTierBuildingFactor });
    const f = productionFactors(state, b);
    if (id === 'catcher' && f.catcher !== 1) reasons.push({ kind: 'decree', factor: f.catcher });
    if (id === 'catcher' && t.kind === 'root' && def?.rootBonus)
      reasons.push({ kind: 'root', factor: 1 + def.rootBonus });
    if (id === 'infirmary' && f.infirmary !== 1) reasons.push({ kind: 'institute', factor: f.infirmary });
    const effects = Object.fromEntries(Object.entries(out.effects).map(([k, v]) => [k, Math.round(v)]));
    output = { effects, base: out.base, reasons };
  }

  const moods = roomMoods(state, data, tier, staff, residents);
  const visited = state.visit?.day === state.day ? state.visit : null;
  return {
    tier,
    slot,
    id,
    name: def?.name ?? id,
    fixed: !!def?.fixed,
    stage: def?.fixed ? 2 : 1,
    abandoned: t.abandoned,
    workers: staff,
    residents,
    output,
    moods,
    line: pickLine(state, data, id, moods, tier, slot),
    visit: {
      effects: b.rooms.visit[id] ?? {},
      blocker: visitBlocker(state, data, tier, slot),
      here: !!visited && visited.tier === tier && visited.slot === slot,
    },
  };
}

function roomMoods(
  state: GameState,
  data: GameData,
  tier: number,
  staff: { have: number; need: number } | null,
  residents: RoomInfo['residents'],
): RoomMood[] {
  const b = data.balance;
  const th = b.thresholds;
  const st = state.stats;
  const night = forecastNight(state, data);
  const moods = new Set<RoomMood>();
  if (isTierInMist(state, b, tier)) moods.add('mist');
  else if (tier === 0 && state.altitude - state.mist < b.rooms.frostGap) moods.add('frost');
  if (night.etherShortfall > 0) moods.add('dark');
  if (night.foodShortage) moods.add('hungry');
  if (st.health < (th.healthDeaths ?? 0)) moods.add('sick');
  if (st.order < (th.orderTheft ?? 0)) moods.add('unrest');
  if (st.trust < (th.trustRumors ?? 0)) moods.add('rumors');
  if (st.solidarity < (th.solidarityCrisis ?? 0)) moods.add('quarrel');
  if (staff && staff.have === 0) moods.add('empty');
  else if (staff && staff.have < staff.need) moods.add('short');
  if (residents && residentsByTier(state, b).homeless > 0) moods.add('crowded');
  if (st.solidarity >= b.rooms.festiveSolidarity) moods.add('festive');
  if (!moods.size) moods.add('calm');
  return ROOM_MOODS.filter((m) => moods.has(m));
}

/**
 * Голос комнаты: первое по важности настроение, у которого есть реплика для этого здания
 * (сначала реплики здания, потом общие); спокойная комната — реплики без настроения, сначала
 * с выполненным условием по флагам. Номер реплики зависит от дня и слота, без генератора.
 */
function pickLine(
  state: GameState,
  data: GameData,
  id: string,
  moods: RoomMood[],
  tier: number,
  slot: number,
): RoomLine | null {
  const fits = (l: RoomLine) => (!l.b || l.b === id) && checkRequires(l.requires, state);
  const pick = (list: RoomLine[]) => list[(state.day * 7 + tier * 3 + slot) % list.length] ?? null;
  const lines = data.rooms.lines.filter(fits);
  for (const m of moods) {
    const pool = lines.filter((l) => (m === 'calm' ? !l.mood || l.mood === 'calm' : l.mood === m));
    if (!pool.length) continue;
    const own = pool.filter((l) => l.b === id);
    const flagged = (own.length ? own : pool).filter((l) => l.requires);
    return pick(flagged.length ? flagged : own.length ? own : pool);
  }
  // Ни одно настроение не дало реплики — спокойные реплики здания или общие
  const calm = lines.filter((l) => !l.mood);
  const own = calm.filter((l) => l.b === id);
  return pick(own.length ? own : calm);
}

/** Почему Председатель не может зайти в эту комнату; null — можно. */
export function visitBlocker(state: GameState, data: GameData, tier: number, slot: number): string | null {
  const t = state.tiers[tier];
  const id = t?.slots[slot];
  if (state.ending) return 'Игра окончена';
  if (!t || !id) return 'Здесь никого нет';
  if (t.abandoned) return 'Ярус заброшен';
  if (state.visit?.day === state.day) {
    const was = state.tiers[state.visit.tier]?.slots[state.visit.slot];
    const name = was ? (data.balance.buildings[was]?.name ?? was) : 'другую комнату';
    return `Сегодня вы уже заходили: ${name}`;
  }
  return null;
}

/** Обход: раз в день зайти в одну комнату. Эффект — сразу, в журнал — строка. */
export function visitRoom(state: GameState, data: GameData, tier: number, slot: number): ActionResult {
  const why = visitBlocker(state, data, tier, slot);
  if (why) return { ok: false, reason: why };
  const id = state.tiers[tier]?.slots[slot] ?? '';
  const s = cloneState(state);
  addEffects(s, data.balance.rooms.visit[id]);
  s.visit = { day: s.day, tier, slot };
  const name = data.balance.buildings[id]?.name ?? id;
  s.log = [...s.log, { day: s.day, text: `Председатель зашёл к людям: ${name}.` }];
  return { ok: true, state: s };
}

/** Ответ жителей на обход. */
export function visitReply(data: GameData, id: string): { who: string; text: string } | null {
  return data.rooms.visit[id] ?? data.rooms.visit['*'] ?? null;
}
