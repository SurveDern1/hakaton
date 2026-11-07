// Выбор варианта события: доступность (ТЗ 6.7), применение (ТЗ 6.2, 10.3) и подсказка до выбора (6.3, 6.7).
// applyChoice работает на копии состояния; previewChoice — это applyChoice на копии, сведённый к стрелкам.
import { findEvent } from './events';
import { checkRequires } from './requires';
import type {
  ActiveModifier,
  Choice,
  EffectKey,
  Effects,
  EndingPath,
  FactionKey,
  GameData,
  GameState,
  ResKey,
  StatKey,
  TierKind,
} from './types';

const RES_KEYS: ResKey[] = ['pop', 'food', 'ether', 'mat'];
const STAT_KEYS: StatKey[] = ['trust', 'solidarity', 'health', 'order'];
const FACTION_KEYS: FactionKey[] = ['stokers', 'institute', 'mistborn', 'sky'];

/** Родительный падеж для «Нужно 15 материалов». */
const RES_GENITIVE: Record<ResKey, string> = {
  pop: 'жителей',
  food: 'еды',
  ether: 'эфира',
  mat: 'материалов',
};

/** Шрам на месте сброшенного яруса (обрубок балки, ТЗ 5.1). */
export const DROPPED_TIER_SCAR = 'tier_stump';

export type ChoiceStatus = 'ok' | 'cost' | 'locked' | 'hidden';

export interface ChoiceAvailability {
  /** Можно нажать. */
  available: boolean;
  /** Показывать ли вариант: `hidden` — requires не выполнено и нет `lockedText`. */
  visible: boolean;
  status: ChoiceStatus;
  /** Почему закрыт: `lockedText` или «Нужно 15 материалов». */
  reason?: string;
  /** Сколько ресурсов не хватает. */
  missing?: Partial<Record<ResKey, number>>;
}

/** Доступность варианта: сначала `requires`, затем хватает ли `cost` (ТЗ 6.7). */
export function choiceAvailability(state: GameState, choice: Choice): ChoiceAvailability {
  if (!checkRequires(choice.requires, state)) {
    return choice.lockedText
      ? { available: false, visible: true, status: 'locked', reason: choice.lockedText }
      : { available: false, visible: false, status: 'hidden' };
  }
  const missing: Partial<Record<ResKey, number>> = {};
  const reasons: string[] = [];
  for (const key of RES_KEYS) {
    const need = choice.cost?.[key] ?? 0;
    if (need > state.res[key]) {
      missing[key] = need - state.res[key];
      reasons.push(`${need} ${RES_GENITIVE[key]}`);
    }
  }
  if (reasons.length > 0) {
    return {
      available: false,
      visible: true,
      status: 'cost',
      reason: `Нужно ${reasons.join(', ')}`,
      missing,
    };
  }
  return { available: true, visible: true, status: 'ok' };
}

export interface ChoiceDeltas {
  res: Partial<Record<ResKey, number>>;
  stats: Partial<Record<StatKey, number>>;
  factions: Partial<Record<FactionKey, number>>;
  altitude: number;
  mist: number;
}

export interface TowerResult {
  dropped?: { index: number; kind: TierKind; killed: number };
  scar?: string;
  unlock?: string;
}

/** Что показать игроку после выбора (ТЗ 6.4). */
export interface ChoiceResult {
  eventId: string;
  choiceIndex: number;
  reply?: { who: string; text: string };
  /** Итоговые изменения после ограничений 0–100, ≥0 и диапазона фракций; нули не попадают. */
  deltas: ChoiceDeltas;
  /** «Это запомнят»: поставленные флаги и запланированные события. */
  remembered: { flags: string[]; delayed: { day: number; event: string }[] };
  modifiers: ActiveModifier[];
  tower: TowerResult | null;
  /** Новые записи стенгазеты. */
  log: string[];
  memory?: { id: number; who: string; text: string };
  ending?: EndingPath;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function applyEffects(state: GameState, effects: Effects | undefined): void {
  if (!effects) return;
  for (const [key, value] of Object.entries(effects) as [EffectKey, number][]) {
    if (!value) continue;
    if ((RES_KEYS as string[]).includes(key)) {
      const k = key as ResKey;
      state.res[k] = Math.max(0, state.res[k] + value);
    } else if ((STAT_KEYS as string[]).includes(key)) {
      const k = key as StatKey;
      state.stats[k] = clamp(state.stats[k] + value, 0, 100);
    } else if (key === 'altitude' || key === 'mist') {
      state[key] = Math.max(0, state[key] + value);
    }
  }
}

/** Сколько жителей живёт в каждом ярусе: места заполняются снизу вверх (ТЗ 4.3). */
export function tierOccupants(state: GameState, data: GameData): number[] {
  const { builtInHousing } = data.balance.tower;
  let left = state.res.pop;
  return state.tiers.map((tier) => {
    if (tier.abandoned) return 0;
    let capacity = builtInHousing[tier.kind] ?? 0;
    for (const slot of tier.slots) if (slot) capacity += data.balance.buildings[slot]?.housing ?? 0;
    const here = Math.min(capacity, left);
    left -= here;
    return here;
  });
}

/**
 * Сброс яруса (ТЗ 5.1): только обычный ярус, не Корень и не Шпиль. `empty` — ярус с наименьшим
 * числом жителей (при равенстве — верхний), `lower` — нижний обычный ярус вместе с жителями.
 */
function dropTier(state: GameState, data: GameData, mode: 'empty' | 'lower'): TowerResult['dropped'] {
  const occupants = tierOccupants(state, data);
  const candidates = state.tiers.map((t, i) => ({ t, i })).filter(({ t }) => t.kind === 'tier');
  if (candidates.length === 0) return undefined;
  let pick = candidates[0];
  if (mode === 'empty') {
    for (const c of candidates) if ((occupants[c.i] ?? 0) <= (occupants[pick?.i ?? 0] ?? 0)) pick = c;
  }
  if (!pick) return undefined;
  const killed = pick.t.abandoned ? 0 : (occupants[pick.i] ?? 0);
  state.tiers.splice(pick.i, 1);
  state.res.pop = Math.max(0, state.res.pop - killed);
  if (killed > 0) {
    const s = data.balance.tower.dropTier.solidarityPerTierWithPeople;
    state.stats.solidarity = clamp(state.stats.solidarity + s, 0, 100);
  }
  if (!state.scars.includes(DROPPED_TIER_SCAR)) state.scars.push(DROPPED_TIER_SCAR);
  return { index: pick.i, kind: pick.t.kind, killed };
}

function diff(before: GameState, after: GameState): ChoiceDeltas {
  const pick = <K extends string>(keys: K[], a: Record<K, number>, b: Record<K, number>) => {
    const out: Partial<Record<K, number>> = {};
    for (const k of keys) if (b[k] !== a[k]) out[k] = b[k] - a[k];
    return out;
  };
  return {
    res: pick(RES_KEYS, before.res, after.res),
    stats: pick(STAT_KEYS, before.stats, after.stats),
    factions: pick(FACTION_KEYS, before.factions, after.factions),
    altitude: after.altitude - before.altitude,
    mist: after.mist - before.mist,
  };
}

/**
 * Применяет вариант `choiceIndex` события `eventId`. Порядок: cost → effects → factions →
 * extraEffects (условие проверяется по состоянию до выбора) → clearFlags/setFlags → delayed →
 * modifiers → tower → unlockMemory → ending → seen и стенгазета.
 * Модификатор получает `left = nights`; `startInNights` остаётся в нём как отсрочка для ночного расчёта.
 * Модификатор с тем же id заменяет прежний. Недоступный вариант — исключение.
 */
export function applyChoice(
  state: GameState,
  data: GameData,
  eventId: string,
  choiceIndex: number,
): { state: GameState; result: ChoiceResult } {
  const event = findEvent(data, eventId);
  const choice = event.choices[choiceIndex];
  if (!choice) throw new Error(`Нет варианта ${choiceIndex} в событии ${eventId}`);
  const availability = choiceAvailability(state, choice);
  if (!availability.available) {
    throw new Error(`Вариант ${choiceIndex} события ${eventId} недоступен: ${availability.status}`);
  }

  const next = clone(state);
  const log: string[] = [];

  for (const key of RES_KEYS) next.res[key] = Math.max(0, next.res[key] - (choice.cost?.[key] ?? 0));
  applyEffects(next, choice.effects);

  const [lo, hi] = data.balance.factions.range;
  for (const [key, value] of Object.entries(choice.factions ?? {}) as [FactionKey, number][]) {
    next.factions[key] = clamp(next.factions[key] + value, lo, hi);
  }

  for (const extra of choice.extraEffects ?? []) {
    if (!checkRequires(extra.requires, state)) continue;
    applyEffects(next, extra.effects);
    if (extra.log) log.push(extra.log);
  }

  const clear = new Set(choice.clearFlags ?? []);
  next.flags = next.flags.filter((f) => !clear.has(f));
  const newFlags: string[] = [];
  for (const f of choice.setFlags ?? []) {
    if (!next.flags.includes(f)) next.flags.push(f);
    newFlags.push(f);
  }

  const delayed = (choice.delayed ?? []).map((d) => ({ day: state.day + d.inDays, event: d.event }));
  next.scheduled.push(...delayed);

  const modifiers: ActiveModifier[] = (choice.modifiers ?? []).map((m) => ({ ...clone(m), left: m.nights }));
  for (const m of modifiers) {
    next.modifiers = next.modifiers.filter((old) => old.id !== m.id);
    next.modifiers.push(m);
  }

  let tower: TowerResult | null = null;
  if (choice.tower) {
    tower = {};
    if (choice.tower.dropTier) tower.dropped = dropTier(next, data, choice.tower.dropTier);
    if (choice.tower.scar) {
      if (!next.scars.includes(choice.tower.scar)) next.scars.push(choice.tower.scar);
      tower.scar = choice.tower.scar;
    }
    if (choice.tower.unlock) {
      if (!next.unlocked.includes(choice.tower.unlock)) next.unlocked.push(choice.tower.unlock);
      tower.unlock = choice.tower.unlock;
    }
  }

  let memory: ChoiceResult['memory'];
  if (choice.unlockMemory && next.memories < data.endings.memories.length) {
    memory = data.endings.memories[next.memories];
    next.memories++;
  }

  if (choice.ending) next.ending = choice.ending;

  next.seen[eventId] = state.day;
  log.unshift(choice.log);
  for (const text of log) next.log.push({ day: state.day, text });

  const result: ChoiceResult = {
    eventId,
    choiceIndex,
    deltas: diff(state, next),
    remembered: { flags: newFlags, delayed },
    modifiers,
    tower,
    log,
  };
  if (choice.reply) result.reply = choice.reply;
  if (memory) result.memory = memory;
  if (choice.ending) result.ending = choice.ending;
  return { state: next, result };
}

export interface PreviewArrow<K extends string> {
  key: K;
  dir: 'up' | 'down';
  /** Сколько стрелок: 1–3 по шагам `balance.preview`. */
  level: number;
  /** «↑↑», «↓». */
  arrows: string;
}

export interface ChoicePreview {
  availability: ChoiceAvailability;
  stats: PreviewArrow<StatKey>[];
  res: PreviewArrow<ResKey | 'altitude' | 'mist'>[];
  /** Портреты фракций с «+»/«−», только при |изменении| ≥ `factionPortraitMin`. */
  factions: { key: FactionKey; sign: '+' | '-' }[];
  /** «⧗ это запомнят»: вариант ставит флаги или откладывает событие. */
  remembered: boolean;
  /** Вариант завершает игру выбранным путём. */
  ending?: EndingPath;
}

function arrow<K extends string>(key: K, delta: number, steps: number[]): PreviewArrow<K> | null {
  const level = steps.filter((s) => Math.abs(delta) >= s).length;
  if (level === 0) return null;
  const dir = delta > 0 ? 'up' : 'down';
  return { key, dir, level, arrows: (dir === 'up' ? '↑' : '↓').repeat(level) };
}

/**
 * Подсказка до выбора: применяет вариант к копии и переводит итоговые изменения в стрелки.
 * Недоступный вариант возвращает только `availability` и `remembered`.
 */
export function previewChoice(
  state: GameState,
  data: GameData,
  eventId: string,
  choiceIndex: number,
): ChoicePreview {
  const choice = findEvent(data, eventId).choices[choiceIndex];
  if (!choice) throw new Error(`Нет варианта ${choiceIndex} в событии ${eventId}`);
  const availability = choiceAvailability(state, choice);
  const remembered = (choice.setFlags?.length ?? 0) > 0 || (choice.delayed?.length ?? 0) > 0;
  const preview: ChoicePreview = { availability, stats: [], res: [], factions: [], remembered };
  if (choice.ending) preview.ending = choice.ending;
  if (!availability.available) return preview;

  const { deltas } = applyChoice(state, data, eventId, choiceIndex).result;
  const { statSteps, resSteps, factionPortraitMin } = data.balance.preview;
  for (const key of STAT_KEYS) {
    const a = arrow(key, deltas.stats[key] ?? 0, statSteps);
    if (a) preview.stats.push(a);
  }
  for (const key of RES_KEYS) {
    const a = arrow(key, deltas.res[key] ?? 0, resSteps);
    if (a) preview.res.push(a);
  }
  for (const key of ['altitude', 'mist'] as const) {
    const a = arrow(key, deltas[key], resSteps);
    if (a) preview.res.push(a);
  }
  for (const key of FACTION_KEYS) {
    const d = deltas.factions[key] ?? 0;
    if (Math.abs(d) >= factionPortraitMin) preview.factions.push({ key, sign: d > 0 ? '+' : '-' });
  }
  return preview;
}
