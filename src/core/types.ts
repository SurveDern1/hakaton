// Типы данных из data/*.json (ТЗ, раздел 10) и состояния игры (10.2).
// Этот слой не знает про Phaser и DOM: core проверяется тестами в Node.

export type ResKey = 'pop' | 'food' | 'ether' | 'mat';
export type StatKey = 'trust' | 'solidarity' | 'health' | 'order';
export type EffectKey = ResKey | StatKey | 'altitude' | 'mist';
export type FactionKey = 'stokers' | 'institute' | 'mistborn' | 'sky';
export type EngineMode = 'hold' | 'climb' | 'save';
export type TierKind = 'root' | 'tier' | 'spire';
export type EndingPath = 'harbor' | 'seal' | 'hold';

export type Res = Record<ResKey, number>;
export type Stats = Record<StatKey, number>;
export type Factions = Record<FactionKey, number>;
export type Effects = Partial<Record<EffectKey, number>>;
export type FactionDelta = Partial<Record<FactionKey, number>>;

/** Диапазон для условий: min и max включительно. */
export interface Range {
  min?: number;
  max?: number;
}

/** Условие показа события, варианта или абзаца (ТЗ 10.4). */
export interface Requires {
  flags?: string[];
  notFlags?: string[];
  anyFlags?: string[];
  minDay?: number;
  maxDay?: number;
  stats?: Partial<Record<StatKey, Range>>;
  factions?: Partial<Record<FactionKey, Range>>;
  res?: Partial<Record<ResKey, Range>>;
  buildings?: Record<string, number>;
  any?: Requires[];
}

export interface Modifier {
  id: string;
  label?: string;
  nights: number;
  perNight?: Effects;
  factionsPerNight?: FactionDelta;
  needPerNight?: number;
  lockBuild?: string[];
  startInNights?: number;
}

export interface TowerChange {
  dropTier?: 'empty' | 'lower';
  scar?: string;
  unlock?: string;
}

export interface Choice {
  label: string;
  requires?: Requires;
  lockedText?: string;
  cost?: Partial<Res>;
  effects?: Effects;
  factions?: FactionDelta;
  setFlags?: string[];
  clearFlags?: string[];
  delayed?: { inDays: number; event: string }[];
  modifiers?: Modifier[];
  extraEffects?: { requires?: Requires; effects?: Effects; log?: string }[];
  tower?: TowerChange | null;
  unlockMemory?: boolean;
  ending?: EndingPath;
  reply?: { who: string; text: string };
  log: string;
}

export interface GameEvent {
  id: string;
  day?: number;
  pool?: 'common' | 'crisis' | null;
  weight?: number;
  once?: boolean;
  title: string;
  text: string;
  portrait?: string;
  requires?: Requires;
  extraText?: { requires?: Requires; text: string }[];
  choices: Choice[];
}

export interface EventsFile {
  version: number;
  events: GameEvent[];
}

export interface Ending {
  id: string;
  title: string;
  poster?: string;
  /** Какой экран итога показать перед финалом: выжили или погибли (`EndingsFile.verdicts`). */
  verdict?: 'win' | 'lose';
  text: string;
  extraText?: { requires?: Requires; text: string }[];
}

/** Экран итога «Вы выжили!» / «Вы умерли…»: картинка из public/ и живой текст поверх. */
export interface Verdict {
  title: string;
  text: string;
  /** Путь в public/ без ведущего «/». */
  image: string;
  /** Где стоит надпись: сверху или снизу картинки. */
  at: 'top' | 'bottom';
  alt: string;
}

export interface Fate {
  flags?: string[];
  default?: boolean;
  text: string;
}

/** Строка характеристики: первая подходящая в своей группе (условия и/или концовка). */
export interface ReferenceLine {
  requires?: Requires;
  /** id концовок, при которых строка подходит. */
  endings?: string[];
  text: string;
}

/** Значок на экране финала: выдаётся, если выполнено `requires`. */
export interface Award {
  id: string;
  title: string;
  text: string;
  requires: Requires;
}

export interface EndingsFile {
  version: number;
  endings: Ending[];
  verdicts: Record<'win' | 'lose', Verdict>;
  harborRefused: string;
  fates: Record<string, Fate[]>;
  /** «Характеристика на Председателя»: группы строк, из каждой — первая подходящая. */
  reference: ReferenceLine[][];
  awards: Award[];
  memories: { id: number; who: string; text: string }[];
}

export interface BuildingDef {
  name: string;
  /** Подпись в духе типового проекта: показывается в меню слота и в строке «Построено». */
  kind?: string;
  fixed?: boolean;
  cost?: number;
  workers?: number;
  housing?: number;
  perNight?: Effects;
  tiers?: TierKind[];
  allowed?: string;
  rootBonus?: number;
  locked?: boolean;
  maxCount?: number;
  afterMvp?: boolean;
  forecastNights?: number;
}

export interface TierDef {
  kind: TierKind;
  slots: (string | null)[];
}

export interface DecreeDef {
  name: string;
  fromDay: number;
  perNight?: Effects;
  factions?: FactionDelta;
  catcherFactor?: number;
  foodFactor?: number;
}

/** data/balance.json. Описаны поля, которые читает код; новые добавляются по мере надобности. */
export interface Balance {
  calendar: { firstDay: string; days: number; finalDay: string };
  start: {
    res: Res;
    stats: Stats;
    factions: Factions;
    altitude: number;
    mist: number;
    engineMode: EngineMode;
    tiers: TierDef[];
  };
  tower: {
    tierHeight: number;
    maxTiers: number;
    slotsPerTier: number;
    builtInHousing: Partial<Record<TierKind, number>>;
    newTier: { baseCost: number; costPerExtraTier: number; nights: number };
    dropTier: { solidarityPerTierWithPeople: number };
    mistNightsToAbandon: number;
    mistTierBuildingFactor: number;
    mistTierHealth: number;
    rootInMistNeedFactor: number;
  };
  engine: {
    need: { base: number; perTier: number; perTenPop: number };
    modes: Record<EngineMode, { burnFactor: number; altitude: number }>;
    shortfallAltitudeLoss: number;
  };
  mist: { risePerNight: number; risePerEther: number; breathVisual: number; greyNightBonus: number };
  food: { perPerson: number; shortageHealth: number; shortageTrust: number };
  drift: Partial<Record<StatKey, number>>;
  health: { perTwoHomeless: number; homelessCap: number };
  thresholds: Record<string, number>;
  buildings: Record<string, BuildingDef>;
  demolishRefund: number;
  decrees: { maxActive: number; cooldownDays: number; list: Record<string, DecreeDef> };
  factions: {
    range: [number, number];
    allyAt: number;
    enemyAt: number;
    eventAt: number;
    passive: Record<FactionKey, Record<'ally' | 'enemy', Record<string, number | boolean>>>;
  };
  events: { maxWindowsPerMorning: number; poolRepeatGapDays: number };
  /** Пороги финала (ТЗ 6.9); раскол — по `thresholds.solidarityCrisis`. */
  endings: { harborSolidarity: number; fortressOrder: number; sealTrust: number };
  preview: { statSteps: number[]; resSteps: number[]; factionPortraitMin: number };
}

/** Тексты для настроения из data/flavor.json: колонка «Радио Седьмой отвечает» в стенгазете. */
export interface FlavorFile {
  version: number;
  /** Вопрос и ответ на каждый день, по порядку дней; день больше длины списка берёт по кругу. */
  radio: { q: string; a: string }[];
}

export interface GameData {
  balance: Balance;
  events: GameEvent[];
  endings: EndingsFile;
  flavor: FlavorFile;
}

export interface Tier extends TierDef {
  mistNights: number;
  abandoned: boolean;
}

export interface ActiveModifier extends Modifier {
  /** Сколько ночей ещё действует (после отсрочки). */
  left: number;
}

/** Всё, что меняется за игру; сериализуется в localStorage как есть (ТЗ 10.2). */
export interface GameState {
  day: number;
  /** Состояние генератора случайных чисел: та же история выборов даёт ту же игру. */
  rng: number;
  res: Res;
  stats: Stats;
  factions: Factions;
  altitude: number;
  mist: number;
  engineMode: EngineMode;
  tiers: Tier[];
  building: { nightsLeft: number } | null;
  decrees: string[];
  decreeCooldown: Record<string, number>;
  modifiers: ActiveModifier[];
  flags: string[];
  scheduled: { day: number; event: string }[];
  seen: Record<string, number>;
  log: { day: number; text: string }[];
  scars: string[];
  unlocked: string[];
  memories: number;
  ending: string | null;
}
