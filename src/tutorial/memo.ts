// «Памятка» (меню игры): пройденные подсказки обучения списком по разделам. Чистые функции без DOM —
// их проверяет memo.test.ts; окно рисует memo-window.ts, открывает пункт меню из index.ts.
// Тексты те же, что на карточках (data/tutorial.json), раздел берётся по якорю шага.
import type { Balance } from '../core/types';
import { WELCOME_ID } from './flow';
import {
  fillText,
  type TutorialAnchor,
  type TutorialFile,
  type TutorialLayout,
  type TutorialStep,
} from './schema';

export const MEMO_SECTIONS = [
  { id: 'event', title: 'Окно события' },
  { id: 'hud', title: 'Шапка и запасы' },
  { id: 'build', title: 'Стройка' },
  { id: 'night', title: 'Ночь и двигатель' },
  { id: 'mist', title: 'Мгла и ярусы' },
  { id: 'stats', title: 'Показатели' },
  { id: 'factions', title: 'Фракции' },
  { id: 'decrees', title: 'Декреты' },
  { id: 'other', title: 'Прочее' },
] as const;

export type MemoSectionId = (typeof MEMO_SECTIONS)[number]['id'];

/**
 * Раздел памятки по якорю вида. Record по всем якорям: новый якорь в schema.ts не соберётся, пока ему
 * не назначен раздел. `center` раздела не задаёт — шаг уходит в раздел по другому виду или в «Прочее».
 */
export const MEMO_SECTION_OF: Record<TutorialAnchor, MemoSectionId | null> = {
  center: null,
  event_arrows: 'event',
  event_memory: 'event',
  event_legend: 'event',
  event_report: 'event',
  event_locked: 'event',
  hud_resources: 'hud',
  hud_altitude: 'mist',
  hud_mist: 'mist',
  hud_menu: 'other',
  tower: 'build',
  slot_root_empty: 'build',
  tier_in_mist: 'mist',
  build_menu: 'build',
  tab_stats: 'stats',
  tab_factions: 'factions',
  tab_decrees: 'decrees',
  tab_night: 'night',
  stats: 'stats',
  factions: 'factions',
  decrees: 'decrees',
  night_forecast: 'night',
  engine_modes: 'night',
  new_tier: 'mist',
  end_day: 'night',
  end_warn: 'night',
};

export interface MemoEntry {
  id: string;
  title: string;
  /** Разные тексты видов шага, без повторов и без «откройте вкладку», если есть суть. */
  texts: string[];
}

export interface MemoSection {
  id: MemoSectionId;
  title: string;
  entries: MemoEntry[];
}

export interface Memo {
  sections: MemoSection[];
  /** Пройдено подсказок и сколько их всего (без приветствия). */
  done: number;
  total: number;
}

const isTab = (target: TutorialAnchor) => target.startsWith('tab_');

export function memoSection(step: TutorialStep): MemoSectionId {
  for (const v of step.views) {
    const s = MEMO_SECTION_OF[v.target];
    if (s) return s;
  }
  return 'other';
}

/**
 * Запись памятки по шагу. Виды другой раскладки отбрасываются, если остаётся хоть один; так же
 * отбрасываются виды-указатели на вкладку («Откройте вкладку „Ночь“»), если у шага есть вид по сути.
 */
export function memoEntry(step: TutorialStep, balance: Balance, layout: TutorialLayout): MemoEntry {
  let views = step.views.filter((v) => !v.layout || v.layout === layout);
  if (!views.length) views = step.views;
  const essence = views.filter((v) => !isTab(v.target));
  if (essence.length) views = essence;
  const texts = [...new Set(views.map((v) => fillText(v.text, balance)))];
  const title = views.find((v) => v.title)?.title ?? step.views.find((v) => v.title)?.title;
  const section = MEMO_SECTIONS.find((s) => s.id === memoSection(step));
  return { id: step.id, title: fillText(title ?? section?.title ?? '', balance), texts };
}

/** Памятка: пройденные шаги (progress.done) по разделам в порядке MEMO_SECTIONS, внутри — как в файле. */
export function buildMemo(
  file: TutorialFile,
  balance: Balance,
  done: readonly string[],
  layout: TutorialLayout,
): Memo {
  const steps = file.steps.filter((s) => s.id !== WELCOME_ID);
  const passed = steps.filter((s) => done.includes(s.id));
  const sections = MEMO_SECTIONS.map((sec) => ({
    id: sec.id,
    title: sec.title,
    entries: passed.filter((s) => memoSection(s) === sec.id).map((s) => memoEntry(s, balance, layout)),
  })).filter((sec) => sec.entries.length);
  return { sections, done: passed.length, total: steps.length };
}
