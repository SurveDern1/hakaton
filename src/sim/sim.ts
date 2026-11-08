// Прогон партии без браузера (ТЗ 14): стратегия игрока проходит 20 дней тем же порядком, что GameLoop —
// утро (buildMorningQueue → applyChoice по каждому окну) → день (стройка, двигатель, декреты) → runNight.
// Нужен для баланса: какие концовки достижимы, где игрок проигрывает, какие события и флаги не встречаются.
import {
  applyChoice,
  build,
  buildBlocker,
  buildMorningQueue,
  choiceAvailability,
  countBuildings,
  createInitialState,
  endingId,
  findEvent,
  forecastNight,
  freeWorkers,
  isTierInMist,
  type NightReport,
  newTierCost,
  nextRandom,
  runNight,
  setEngineMode,
  startNewTier,
  tierMiddle,
  toggleDecree,
} from '../core';
import type {
  EndingPath,
  EngineMode,
  FactionKey,
  Factions,
  GameData,
  GameState,
  Res,
  ResKey,
  StatKey,
  Stats,
} from '../core/types';

const STAT_KEYS: StatKey[] = ['trust', 'solidarity', 'health', 'order'];
const RES_KEYS: ResKey[] = ['pop', 'food', 'ether', 'mat'];
const FACTION_KEYS: FactionKey[] = ['stokers', 'institute', 'mistborn', 'sky'];
const FLOOR_PENALTY = 3;

/** Как стратегия выбирает варианты и ведёт башню. */
export interface Strategy {
  id: string;
  name: string;
  /** Вес изменения показателя, ресурса, фракции и высоты в оценке варианта события. */
  weights: { stats?: Partial<Stats>; res?: Partial<Res>; factions?: Partial<Factions>; altitude?: number };
  /** Заранее решённые события: `eventId → индекс варианта`, если он доступен. */
  prefer?: Record<string, number>;
  /** Флаги, к которым стратегия стремится (+) или которых избегает (−), за каждый — столько очков. */
  flags?: Record<string, number>;
  /** Нижние границы показателей: каждый пункт ниже границы после выбора стоит `floorPenalty` очков. */
  floors?: Partial<Stats>;
  /** Путь в день 20 по порядку предпочтения; недоступный пропускается. */
  final: EndingPath[];
  /** Строит ли что-нибудь днём и трогает ли двигатель. */
  manages: boolean;
  /** Что строить, когда насущное закрыто: по порядку. */
  extraBuilds?: string[];
  /** Декреты, которые включаются, как только открыты. */
  decrees?: string[];
  /** Выбирать варианты случайно (с отдельным генератором, игра от этого не меняется). */
  random?: boolean;
}

export interface DayTrace {
  day: number;
  res: Res;
  stats: Stats;
  factions: Factions;
  altitude: number;
  mist: number;
  tiers: number;
  /** Запас до поражения «Падение»: середина Шпиля минус Мгла, м. */
  spireGap: number;
  rootInMist: boolean;
  events: { id: string; choice: number; label: string }[];
  actions: string[];
  night: Pick<
    NightReport,
    'foodShortage' | 'etherShortfall' | 'deaths' | 'abandoned' | 'tierBuilt' | 'sabotage'
  > | null;
}

export interface SimResult {
  strategy: string;
  seed: number;
  /** id концовки из endings.json (`harbor`, `fall`, …). */
  ending: string;
  harborRefused: boolean;
  /** День, на котором партия закончилась. */
  lastDay: number;
  final: Pick<GameState, 'res' | 'stats' | 'factions' | 'altitude' | 'mist' | 'flags' | 'memories'> & {
    tiers: number;
    spireGap: number;
  };
  /** Минимальный запас до Падения за партию, м. */
  minSpireGap: number;
  foodShortageNights: number;
  etherShortfallNights: number;
  deaths: number;
  abandonedTiers: number;
  /** id показанных событий и выбранные варианты. */
  picks: { id: string; choice: number }[];
  trace: DayTrace[];
}

const spireGap = (s: GameState, data: GameData) =>
  Math.round((tierMiddle(s, data.balance, s.tiers.length - 1) - s.mist) * 10) / 10;

/** Оценка варианта: применяем на копии и взвешиваем разницу состояния. */
function scoreChoice(before: GameState, after: GameState, strategy: Strategy): number {
  const w = strategy.weights;
  let score = 0;
  for (const k of STAT_KEYS) score += (after.stats[k] - before.stats[k]) * (w.stats?.[k] ?? 1);
  for (const k of RES_KEYS) score += (after.res[k] - before.res[k]) * (w.res?.[k] ?? 0.3);
  for (const k of FACTION_KEYS) score += (after.factions[k] - before.factions[k]) * (w.factions?.[k] ?? 0.1);
  score += (after.altitude - before.altitude) * (w.altitude ?? 0.3);
  for (const k of STAT_KEYS) {
    const floor = strategy.floors?.[k];
    if (floor !== undefined) score -= FLOOR_PENALTY * Math.max(0, floor - after.stats[k]);
  }
  for (const [flag, points] of Object.entries(strategy.flags ?? {})) {
    if (after.flags.includes(flag) && !before.flags.includes(flag)) score += points;
  }
  return score;
}

/** Индекс варианта события, который выберет стратегия. `rng` — отдельный генератор для случайной. */
function chooseOption(
  state: GameState,
  data: GameData,
  eventId: string,
  strategy: Strategy,
  rng: { seed: number },
): number {
  const event = findEvent(data, eventId);
  const open = event.choices.flatMap((c, i) => (choiceAvailability(state, c).available ? [i] : []));
  if (open.length === 0) throw new Error(`В событии ${eventId} нет доступных вариантов`);

  const byEnding = event.choices.some((c) => c.ending);
  if (byEnding && !strategy.random) {
    for (const path of strategy.final) {
      const i = open.find((j) => event.choices[j]?.ending === path);
      if (i !== undefined) return i;
    }
  }
  const preferred = strategy.prefer?.[eventId];
  if (preferred !== undefined && open.includes(preferred)) return preferred;
  if (strategy.random) {
    const [r, next] = nextRandom(rng.seed);
    rng.seed = next;
    return open[Math.floor(r * open.length)] ?? open[0] ?? 0;
  }
  let best = open[0] ?? 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const i of open) {
    const score = scoreChoice(state, applyChoice(state, data, eventId, i).state, strategy);
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Первый свободный слот под здание: сверху вниз, ярусы в Мгле — в последнюю очередь.
 * Слоты Корня и яруса над ним держатся под уловители: другие здания туда не встают.
 */
function findSlot(state: GameState, data: GameData, id: string): [number, number] | null {
  const catcherOnly = data.balance.buildings.catcher?.allowed === 'rootAndAbove' ? 1 : -1;
  const order = state.tiers
    .map((_, i) => i)
    .filter((i) => id === 'catcher' || i > catcherOnly)
    .reverse()
    .sort(
      (a, b) => Number(isTierInMist(state, data.balance, a)) - Number(isTierInMist(state, data.balance, b)),
    );
  for (const i of order) {
    const tier = state.tiers[i];
    if (!tier) continue;
    for (let j = 0; j < tier.slots.length; j++) {
      if (buildBlocker(state, data, i, j, id) === null) return [i, j];
    }
  }
  return null;
}

/** Попробовать поставить здание; рабочие нужны свободные, иначе здание простаивает. */
function tryBuild(state: GameState, data: GameData, id: string, actions: string[]): GameState | null {
  const def = data.balance.buildings[id];
  if (!def) return null;
  if ((def.workers ?? 0) > freeWorkers(state, data.balance)) return null;
  const slot = findSlot(state, data, id);
  if (!slot) return null;
  const r = build(state, data, slot[0], slot[1], id);
  if (!r.ok) return null;
  actions.push(`${id}@${slot[0]}:${slot[1]}`);
  return r.state;
}

/** Что сейчас нужнее всего построить, по прогнозу ночи. */
function neededBuildings(state: GameState, data: GameData, strategy: Strategy): string[] {
  const f = forecastNight(state, data);
  const needs: string[] = [];
  if (f.etherShortfall > 0 || f.delta.res.ether < 0) needs.push('catcher');
  if (f.foodShortage || state.res.food + f.delta.res.food * 4 < 0) needs.push('farm');
  if (f.homeless > 0) needs.push('housing');
  if (state.stats.health < 45) needs.push('infirmary');
  if (state.stats.order < 35) needs.push('guard');
  if (countBuildings(state, 'salvage') < 2) needs.push('salvage');
  return [...needs, ...(strategy.extraBuilds ?? [])];
}

/**
 * Режим двигателя. Цель — держать Корень над Мглой: Корень в Мгле ест больше эфира, а его уловители
 * работают вполсилы. Подъём — когда эфира хватит и на него, и на следующую ночь; при нехватке —
 * режим, после которого запас до Мглы больше.
 */
function pickEngine(state: GameState, data: GameData): EngineMode {
  const rootMargin = tierMiddle(state, data.balance, 0) - state.mist;
  const options = (['climb', 'hold', 'save'] as EngineMode[]).map((mode) => {
    const f = forecastNight(setEngineMode(state, mode), data);
    return { mode, f, gain: f.altitudeDelta - f.mistRise, reserve: state.res.ether + f.delta.res.ether };
  });
  const [climb, hold] = options;
  if (climb && hold && climb.f.etherShortfall === 0 && rootMargin < 20 && climb.reserve >= hold.f.etherNeed) {
    return 'climb';
  }
  if (hold && hold.f.etherShortfall === 0) return 'hold';
  return options.reduce((a, c) => (c.gain > a.gain ? c : a)).mode;
}

/** День стратегии: декреты, стройка по нуждам, новый ярус, режим двигателя. */
function playDay(input: GameState, data: GameData, strategy: Strategy, actions: string[]): GameState {
  let s = input;
  for (const id of strategy.decrees ?? []) {
    if (s.decrees.includes(id)) continue;
    const r = toggleDecree(s, data, id);
    if (r.ok) {
      s = r.state;
      actions.push(`decree:${id}`);
    }
  }
  for (let step = 0; step < 6; step++) {
    let built = false;
    for (const id of neededBuildings(s, data, strategy)) {
      const next = tryBuild(s, data, id, actions);
      if (next) {
        s = next;
        built = true;
        break;
      }
    }
    if (!built) break;
  }
  // Новый ярус: когда свободных слотов не осталось или Шпиль близко к Мгле, и материалов с запасом.
  const freeSlots = s.tiers.reduce(
    (n, t, i) =>
      n +
      (t.abandoned || isTierInMist(s, data.balance, i) || t.kind === 'spire'
        ? 0
        : t.slots.filter((x) => !x).length),
    0,
  );
  if (
    !s.building &&
    (freeSlots === 0 || spireGap(s, data) < 25) &&
    s.res.mat >= newTierCost(s, data.balance) + 5
  ) {
    const r = startNewTier(s, data);
    if (r.ok) {
      s = r.state;
      actions.push('new_tier');
    }
  }
  const mode = pickEngine(s, data);
  if (mode !== s.engineMode) {
    s = setEngineMode(s, mode);
    actions.push(`engine:${mode}`);
  }
  return s;
}

/** Одна партия от первого утра до финала. */
export function simulate(data: GameData, strategy: Strategy, seed: number): SimResult {
  let s = createInitialState(data.balance, seed);
  const rng = { seed: (seed ^ 0x9e3779b9) >>> 0 };
  const trace: DayTrace[] = [];
  const picks: SimResult['picks'] = [];
  let minSpireGap = spireGap(s, data);
  let foodShortageNights = 0;
  let etherShortfallNights = 0;
  let deaths = 0;
  let abandonedTiers = 0;

  for (;;) {
    const morning = buildMorningQueue(s, data);
    s = morning.state;
    const events: DayTrace['events'] = [];
    for (const id of morning.queue) {
      if (s.ending) break;
      const choice = chooseOption(s, data, id, strategy, rng);
      s = applyChoice(s, data, id, choice).state;
      picks.push({ id, choice });
      events.push({ id, choice, label: findEvent(data, id).choices[choice]?.label ?? '' });
    }
    const actions: string[] = [];
    if (!s.ending && strategy.manages) s = playDay(s, data, strategy, actions);
    const day: DayTrace = {
      day: s.day,
      res: { ...s.res },
      stats: { ...s.stats },
      factions: { ...s.factions },
      altitude: s.altitude,
      mist: s.mist,
      tiers: s.tiers.length,
      spireGap: spireGap(s, data),
      rootInMist: isTierInMist(s, data.balance, 0),
      events,
      actions,
      night: null,
    };
    trace.push(day);
    if (s.ending || endingId(s, data)) break;
    if (s.day >= data.balance.calendar.days) {
      s = { ...s, ending: 'hold' };
      break;
    }
    const night = runNight(s, data);
    s = night.state;
    const r = night.report;
    day.night = {
      foodShortage: r.foodShortage,
      etherShortfall: r.etherShortfall,
      deaths: r.deaths,
      abandoned: r.abandoned,
      tierBuilt: r.tierBuilt,
      sabotage: r.sabotage,
    };
    if (r.foodShortage) foodShortageNights++;
    if (r.etherShortfall > 0) etherShortfallNights++;
    deaths += r.deaths;
    abandonedTiers += r.abandoned.length;
    minSpireGap = Math.min(minSpireGap, spireGap(s, data));
    if (s.ending) break;
  }

  const resolved = endingId(s, data) ?? { id: 'hold', harborRefused: false };
  return {
    strategy: strategy.id,
    seed,
    ending: resolved.id,
    harborRefused: resolved.harborRefused,
    lastDay: s.day,
    final: {
      res: s.res,
      stats: s.stats,
      factions: s.factions,
      altitude: s.altitude,
      mist: s.mist,
      flags: s.flags,
      memories: s.memories,
      tiers: s.tiers.length,
      spireGap: spireGap(s, data),
    },
    minSpireGap,
    foodShortageNights,
    etherShortfallNights,
    deaths,
    abandonedTiers,
    picks,
    trace,
  };
}
