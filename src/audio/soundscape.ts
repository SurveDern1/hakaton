// Фон башни как чистая функция: какое звучание должно быть сейчас — ветер, двигатель, Мгла, скрипы,
// приглушение под окнами. Без Web Audio, с тестами (soundscape.test.ts), как stateCues.
// Порядок: index.ts (или лаборатория) → soundInputFromState(state, balance) → soundscape(вход, фаза, ui)
// → Ambience.set(цели) (ambience.ts), где узлы плавно идут к целям.
// Из баланса берутся только игровые величины (высота, ярус, Мгла); частоты и громкости звука — здесь.
import { type Balance, type EngineMode, type GameState, isTierInMist } from '../core';
import { etherLevel } from '../scenes/tower-model';

/** Фаза игрового цикла (как Phase в src/game/loop.ts). */
export type AmbPhase = 'start' | 'morning' | 'day' | 'night' | 'final';

/** Что открыто поверх башни: окна приглушают фон. */
export interface AmbUi {
  /** Окно утреннего события или отчёт о ночи (.ev-layer). */
  event: boolean;
  /** Стенгазета (.pp-layer). */
  paper: boolean;
  /** Комикс (.cx-layer). */
  comic: boolean;
  /** Плакат итога (.vd) или экран финала (.fin-layer). */
  verdict: boolean;
}

export const NO_UI: AmbUi = { event: false, paper: false, comic: false, verdict: false };

/** Игровые величины, от которых зависит фон. Лаборатория задаёт их ползунками. */
export interface SoundInput {
  mode: EngineMode;
  /** Запас эфира 0..1 — та же доля, что у картинки луча (etherLevel). */
  ether: number;
  /** Зазор «низ башни − уровень Мглы», м; ≤ 0 — Корень в Мгле. */
  mistGap: number;
  /** Высота яруса, м (balance.tower.tierHeight). */
  tierHeight: number;
  /** Высота над стартовой 0..1: доля от стартовой до стартовой + все ярусы (tierHeight × maxTiers). */
  heightFrac: number;
  /** Сколько ярусов в Мгле. */
  tiersInMist: number;
  /** Сколько шрамов (заплаты, сброшенный ярус). */
  scars: number;
}

export interface WindTargets {
  /** Громкость слоя 0..1. */
  gain: number;
  /** Глубина порывов 0..1: насколько громкость и полоса гуляют. */
  gust: number;
  /** Центр полосы ветра, Гц: выше — резче и ближе, ниже — глуше и дальше. */
  center: number;
  /** Доля в «зал»: на старте ветер дальше. */
  far: number;
  /** Средний интервал свиста на конструкциях, с (Infinity — без свиста). */
  whistleEvery: number;
}

export interface EngineTargets {
  gain: number;
  /** Основной тон, Гц: save 38, hold 46, climb 58. */
  f0: number;
  /** Срез фильтра низких частот после насыщения, Гц: глухо в экономии, ярко в наборе. */
  cutoff: number;
  /** Пульсация громкости: частота, Гц, и глубина 0..1. */
  pulseHz: number;
  pulseDepth: number;
  /** Свист турбины ≈ 18·f0, громкость 0..1 от слоя. */
  turbine: number;
  /** Шорох потока эфира — полоса шума, громкость 0..1 от слоя. */
  flow: number;
  /** Перебои 0..1: при эфире < 0,5 гул проваливается и кашляет. */
  stutter: number;
}

export interface MistTargets {
  gain: number;
  /** Насколько открыт фильтр, Гц (срез низких частот над шорохом). */
  open: number;
  /** «Шёпот» — формантные полосы, громкость 0..1 от слоя. */
  whisper: number;
  /** Потрескивание инея, щелчков в секунду. */
  crackle: number;
}

export interface AmbTargets {
  wind: WindTargets;
  engine: EngineTargets;
  mist: MistTargets;
  /** Средний интервал скрипов башни, с (Infinity — не скрипит). */
  creakEvery: number;
  /** Приглушение фона под окнами, дБ (0 — нет). */
  duckDb: number;
  /** Постоянная времени перехода громкостей слоёв, с: финал затухает медленно. */
  fade: number;
}

/** Звучание двигателя по режиму: тон, яркость, пульсация, турбина. */
export const ENGINE_MODES: Record<
  EngineMode,
  Pick<EngineTargets, 'gain' | 'f0' | 'cutoff' | 'pulseHz' | 'pulseDepth' | 'turbine'>
> = {
  save: { gain: 0.34, f0: 38, cutoff: 420, pulseHz: 3, pulseDepth: 0.12, turbine: 0 },
  hold: { gain: 0.5, f0: 46, cutoff: 900, pulseHz: 4.5, pulseDepth: 0.18, turbine: 0.05 },
  climb: { gain: 0.62, f0: 58, cutoff: 1800, pulseHz: 7, pulseDepth: 0.28, turbine: 0.14 },
};

/** Ниже этого запаса эфира двигатель сбивается (как тускнеет луч и кренится башня). */
export const STUTTER_BELOW = 0.5;
/** Мгла слышна ближе стольких ярусов. */
export const MIST_RANGE_TIERS = 2;
/** Ночью Мгла громче во столько раз. */
export const MIST_NIGHT = 1.5;
/** Средний интервал скрипов спокойной башни, с. */
const CREAK_BASE = 30;
const CREAK_MIN = 5;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Вход фона из состояния игры. */
export function soundInputFromState(state: GameState, balance: Balance): SoundInput {
  const tierHeight = balance.tower.tierHeight;
  const span = tierHeight * balance.tower.maxTiers;
  let inMist = 0;
  for (let i = 0; i < state.tiers.length; i++) if (isTierInMist(state, balance, i)) inMist += 1;
  return {
    mode: state.engineMode,
    ether: etherLevel(state, balance),
    mistGap: state.altitude - state.mist,
    tierHeight,
    heightFrac: span > 0 ? clamp((state.altitude - balance.start.altitude) / span, 0, 1) : 0,
    tiersInMist: inMist,
    scars: state.scars.length,
  };
}

/** Близость Мглы 0..1: 0 — дальше MIST_RANGE_TIERS ярусов, 1 — у самого низа башни или ярус в Мгле. */
export function mistNearness(input: SoundInput): number {
  if (input.tiersInMist > 0) return 1;
  const tiers = input.mistGap / Math.max(1, input.tierHeight);
  return clamp(1 - tiers / MIST_RANGE_TIERS, 0, 1);
}

/** Цели фона для состояния, фазы и открытых окон. */
export function soundscape(input: SoundInput, phase: AmbPhase, ui: AmbUi = NO_UI): AmbTargets {
  const night = phase === 'night';
  const ether = clamp(Number.isFinite(input.ether) ? input.ether : 1, 0, 1);
  const h = clamp(input.heightFrac, 0, 1);

  // Ветер: крепче на высоте и ночью; на старте сильнее и дальше, в финале стихает
  const wind: WindTargets = {
    gain: (0.42 + 0.28 * h) * (night ? 1.35 : 1),
    gust: night ? 0.6 : 0.4 + 0.15 * h,
    center: 420 + 380 * h + (night ? 120 : 0),
    far: 0.18,
    whistleEvery: night ? 14 : 26 - 10 * h,
  };
  if (phase === 'start') {
    wind.gain = 0.62;
    wind.gust = 0.55;
    wind.center = 360;
    wind.far = 0.4;
    wind.whistleEvery = 18;
  } else if (phase === 'final') {
    wind.gain = 0.4;
    wind.gust = 0.35;
    wind.center = 380;
    wind.far = 0.35;
    wind.whistleEvery = Infinity;
  }

  // Двигатель: режим задаёт тон и яркость, эфир — ровность
  const m = ENGINE_MODES[input.mode] ?? ENGINE_MODES.hold;
  const stutter = ether < STUTTER_BELOW ? (STUTTER_BELOW - ether) / STUTTER_BELOW : 0;
  const engine: EngineTargets = {
    ...m,
    gain: m.gain * (1 - 0.25 * stutter),
    flow: 0.04 + 0.16 * ether,
    stutter,
  };

  // Мгла: тишина вдали, ближе — громче и ярче, ночью в полную силу
  const near = mistNearness(input);
  const mist: MistTargets = {
    gain: Math.min(1, 0.55 * near * (night ? MIST_NIGHT : 1)),
    open: 700 + 4300 * near,
    whisper: near > 0 ? (night ? 0.9 : 0.45) * near : 0,
    crackle: near * (night ? 1.6 : 0.8),
  };

  // Скрипы: чаще при крене (мало эфира), шрамах и ярусе в Мгле
  const strain = 1 + 2 * stutter + 0.35 * input.scars + 0.8 * input.tiersInMist;
  let creakEvery = Math.max(CREAK_MIN, CREAK_BASE / strain);

  const quiet = phase === 'start' || phase === 'final';
  if (quiet) {
    engine.gain = 0;
    engine.turbine = 0;
    engine.flow = 0;
    engine.stutter = 0;
    mist.gain = 0;
    mist.whisper = 0;
    mist.crackle = 0;
    creakEvery = Infinity;
  }

  // Приглушение: комикс и итог — сильнее (там голос картинки), окна и стенгазета — меньше
  const duckDb = ui.comic || ui.verdict ? -14 : ui.event || ui.paper ? -8 : 0;

  return { wind, engine, mist, creakEvery, duckDb, fade: phase === 'final' ? 1 : 0 };
}
