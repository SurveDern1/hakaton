// Сведение: группы громкости и поправки уровней (план звука, срез 5). Громкость каждого звука меряется
// по рендеру без колонок (lab.ts → metrics.lufs, после ограничителя, настройки по умолчанию) и должна
// лежать в коридоре своей группы; `npm run check:sound` падает, если нет. Поправки ниже — то, чем
// звуки приведены в коридоры: правится число здесь, а не громкости внутри рисунка звука.
//
// Короткий щелчок меряется одним блоком 400 мс (BS.1770), поэтому его LUFS ниже, чем «громкость на
// слух» пика; коридор интерфейса это учитывает так же, как и для остальных звуков — одной шкалой.
import type { SfxName } from './sfx';

export type MixGroup = 'ui' | 'action' | 'large' | 'amb' | 'music';

export interface MixGroupDef {
  title: string;
  /** Коридор интегральной громкости, LUFS. */
  lufs: [number, number];
  /** Пункты лаборатории (id из lab.ts), которые звучат в игре как есть. */
  ids: string[];
}

/**
 * Группы плана: интерфейс тише действий, крупные события громче всех, фон под музыкой.
 * В группы входят только звуки, которые звучат в игре целиком; части составных звуков (sfx:tierDrop
 * внутри event:tierDrop, замены файлов, отдельные слои фона) держит базовая линия check:sound.
 */
export const MIX_GROUPS: Record<MixGroup, MixGroupDef> = {
  ui: {
    title: 'Интерфейс',
    lufs: [-32, -26],
    ids: ['sfx:click', 'sfx:tab', 'sfx:plus', 'sfx:minus', 'sfx:hint', 'sfx:denied', 'sfx:page', 'sfx:paper'],
  },
  action: {
    title: 'Действия',
    lufs: [-26, -20],
    ids: [
      'sfx:build',
      'sfx:build@left',
      'sfx:demolish',
      'sfx:choice',
      'sfx:decree',
      'sfx:eventOpen',
      'sfx:tierStart',
      'sfx:endDay',
      'sfx:morning',
      'event:lever@up',
      'event:lever@down',
      'event:calendar',
      'event:calendarRed',
    ],
  },
  large: {
    title: 'Крупные',
    lufs: [-22, -16],
    ids: ['sfx:tierUp', 'event:tierDrop', 'sfx:final', 'sfx:night', 'radio:vsem'],
  },
  amb: {
    title: 'Фон',
    lufs: [-30, -24],
    ids: [
      'amb:start',
      'amb:hold',
      'amb:climb',
      'amb:save',
      'amb:lowEther',
      'amb:mistNear',
      'amb:night',
      'amb:nightRise',
    ],
  },
  music: {
    title: 'Музыка',
    lufs: [-24, -20],
    ids: ['theme:waltz', 'theme:march', 'theme:wind', 'theme:night', 'theme:final'],
  },
};

export const MIX_GROUP_NAMES = Object.keys(MIX_GROUPS) as MixGroup[];

/** Группа пункта лаборатории или null (части составных звуков, слои фона, замены). */
export function mixGroupOf(id: string): MixGroup | null {
  for (const g of MIX_GROUP_NAMES) if (MIX_GROUPS[g].ids.includes(id)) return g;
  return null;
}

/** Общий уровень всего звука до шин (до ограничителя): им понижается сумма, если худший случай перегружает. */
export const MASTER_LEVEL = 0.8;

/**
 * Мягкий ограничитель на выходе: громкие наложения не хрипят на динамике телефона. Chrome добавляет
 * к выходу автоматическую компенсацию (makeup, около +3,5 дБ при этих числах) — её меряет
 * AudioEngine.makeupDb, ослабление сверх неё в худшем случае — не больше WORST_CASE.reduction.
 */
export const LIMITER = { threshold: -14, knee: 12, ratio: 4, attack: 0.005, release: 0.25 } as const;

/** dB → множитель. */
export const dbGain = (db: number): number => 10 ** (db / 20);

/**
 * Поправки звуков действий, дБ (playSfx умножает на них громкость). Подобраны по таблице
 * check:sound так, чтобы каждый звук лёг в коридор своей группы с запасом около 1 LU.
 */
export const SFX_TRIM_DB: Partial<Record<SfxName, number>> = {
  click: 14,
  tab: 18.5,
  plus: 3,
  minus: 1.5,
  hint: 5,
  denied: 1,
  eventOpen: 1.5,
  build: 3,
  demolish: 1,
  choice: 5,
  decree: 5,
  tierStart: 1,
  endDay: 5,
  tierUp: 0.5,
  night: 1,
};

/** Поправка всей музыки, дБ: с постоянным фоном мелодия должна стоять над ним, а не тонуть. */
export const MUSIC_TRIM_DB = 7;

/** Поправки отдельных тем поверх MUSIC_TRIM_DB, дБ: редкие темы (ночь, «Тишина и ветер») тише по рисунку. */
export const THEME_TRIM_DB: Partial<Record<'waltz' | 'march' | 'wind' | 'night' | 'final', number>> = {
  waltz: 1,
  march: 1.5,
  wind: 7.5,
  night: 4,
};

/** Поправка всего фона, дБ (выход Ambience): сумма слоёв ночью не должна выходить из коридора. */
export const AMB_TRIM_DB = -0.5;

/** Листок календаря и рычаг двигателя (файлы), множители громкости в events.ts. */
export const EVENT_TRIM_DB = { calendar: 4, lever: 2 } as const;

/**
 * Худший случай для сведения: ночь, сброс яруса, музыка, радио и всплывающие числа разом. После
 * ограничителя пик не выше `peakPost`, ограничитель ослабляет не больше чем на `reduction` дБ — иначе
 * понижается сумма (MASTER_LEVEL, поправки), а не душится выход. Рендер `seconds` с — быстрее `renderMs`.
 */
export const WORST_CASE = { seconds: 10, peakPost: -0.5, reduction: 6, renderMs: 2000 } as const;
