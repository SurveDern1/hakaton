// Формат data/tutorial.json, подстановка чисел из баланса и проверка файла.
// Файл без импортов во время выполнения (только типы): его же подключает tools/check-data.js
// через встроенное в Node удаление типов, поэтому проверка в тестах и в check-data одна.
import type { Balance, Requires } from '../core/types';

/** Сценарий первых дней идёт по порядку; подсказки по случаю — по одной и один раз. */
export const CHAINS = ['first', 'tip'] as const;
export const PHASES = ['morning', 'day'] as const;
export const LAYOUTS = ['phone', 'wide'] as const;
/** Случаи, о которых подсказка говорит один раз (считаются в model.ts → tutorialSignals). */
export const SIGNALS = [
  'alarm',
  'homeless',
  'tierInMist',
  'statLow',
  'newDecrees',
  'lockedChoice',
  'memoryHint',
] as const;
/** Вкладки нижней панели телефона (`.tab[data-tab]` в src/ui/panel.ts). */
export const TABS = ['stats', 'factions', 'decrees', 'night'] as const;
/** Состояние экрана, при котором подходит вид шага. */
export const UI_STATES = [
  'menuOpen',
  'menuClosed',
  'eventOpen',
  'reportShown',
  'memoryHint',
  'lockedChoice',
  ...TABS.map((t) => `tab:${t}`),
];
/** Чем заканчивается шаг: кнопкой «Понятно» или действием игрока (model.ts → isDone). */
export const DONES = [
  'ok',
  'built',
  'menuOpen',
  'mode',
  'tier',
  'night',
  'choice',
  ...TABS.map((t) => `tab:${t}`),
];

/**
 * Имена якорей — договор с экраном: селектор каждого задаёт src/tutorial/anchors.ts (срез 3).
 * `center` — карточка без цели, по центру рамки.
 */
export const ANCHORS = [
  'center',
  'event_arrows',
  'event_memory',
  'event_legend',
  'event_report',
  'event_locked',
  'hud_resources',
  'hud_altitude',
  'hud_mist',
  'hud_menu',
  'tower',
  'slot_root_empty',
  'tier_in_mist',
  'build_menu',
  'tab_stats',
  'tab_factions',
  'tab_decrees',
  'tab_night',
  'stats',
  'factions',
  'decrees',
  'night_forecast',
  'engine_modes',
  'new_tier',
  'end_day',
  'end_warn',
] as const;
/** Якоря, видимые утром: утренние шаги указывают только на окно события. */
export const MORNING_ANCHORS: readonly string[] = [
  'center',
  'event_arrows',
  'event_memory',
  'event_legend',
  'event_report',
  'event_locked',
];

export type TutorialChain = (typeof CHAINS)[number];
export type TutorialPhase = (typeof PHASES)[number];
export type TutorialLayout = (typeof LAYOUTS)[number];
export type TutorialSignal = (typeof SIGNALS)[number];
export type TutorialTab = (typeof TABS)[number];
export type TutorialAnchor = (typeof ANCHORS)[number];
export type TutorialUiState =
  | 'menuOpen'
  | 'menuClosed'
  | 'eventOpen'
  | 'reportShown'
  | 'memoryHint'
  | 'lockedChoice'
  | `tab:${TutorialTab}`;
export type TutorialDone =
  | 'ok'
  | 'built'
  | 'menuOpen'
  | 'mode'
  | 'tier'
  | 'night'
  | 'choice'
  | `tab:${TutorialTab}`;

/** Вариант показа шага: подходит первый, у которого совпали `ui` и `layout`. */
export interface TutorialView {
  ui?: TutorialUiState;
  layout?: TutorialLayout;
  target: TutorialAnchor;
  title?: string;
  /** Текст карточки; `{путь}` — число из balance.json (fillText). */
  text: string;
}

export interface TutorialStep {
  id: string;
  chain: TutorialChain;
  phase: TutorialPhase;
  /** Условие ТЗ 10.4 (checkRequires). */
  when?: Requires;
  /** Только у `tip`: случай, при котором подсказка появляется. Без него — по одному `when`. */
  signal?: TutorialSignal;
  views: TutorialView[];
  done: TutorialDone;
}

/** Подписи карточек: кнопки и короткое «Получилось». */
export interface TutorialLabels {
  ok: string;
  skip: string;
  success: string;
  welcomeYes: string;
  welcomeNo: string;
}

export interface TutorialFile {
  version: number;
  /** Чей голос (Р1): знак из src/ui/portraits.ts и подпись. */
  speaker: { portrait: string; name: string };
  labels: TutorialLabels;
  steps: TutorialStep[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const PLACEHOLDER = /\{([^{}]*)\}/g;
/**
 * Длина текста карточки: не больше трёх строк на телефоне 390 px (карточка 340 px). Замер на живом
 * экране: 110 знаков — три строки, 125 — уже четыре.
 */
export const MAX_TEXT = 115;
const REQUIRES_KEYS = [
  'flags',
  'notFlags',
  'anyFlags',
  'minDay',
  'maxDay',
  'stats',
  'factions',
  'res',
  'buildings',
  'any',
];

/** Число из баланса по пути через точку (`tower.mistNightsToAbandon`); иначе undefined. */
export function balanceValue(balance: Balance, path: string): number | undefined {
  let cur: unknown = balance;
  for (const key of path.split('.')) {
    if (!isObj(cur) || !(key in cur)) return undefined;
    cur = cur[key];
  }
  return typeof cur === 'number' && Number.isFinite(cur) ? cur : undefined;
}

/** Подстановка `{путь}` из баланса; дробь — с запятой. Неразрешимый путь остаётся как есть. */
export function fillText(text: string, balance: Balance): string {
  return text.replace(PLACEHOLDER, (whole, path: string) => {
    const v = balanceValue(balance, path.trim());
    return v === undefined ? whole : String(v).replace('.', ',');
  });
}

function checkText(where: string, field: string, text: unknown, balance: Balance, errors: string[]): void {
  if (typeof text !== 'string' || !text.trim()) {
    errors.push(`${where}: пустой ${field}`);
    return;
  }
  for (const m of text.matchAll(PLACEHOLDER)) {
    const path = (m[1] ?? '').trim();
    if (balanceValue(balance, path) === undefined)
      errors.push(`${where}: {${path}} нет числа в balance.json`);
  }
  const shown = fillText(text, balance);
  if (field === 'text' && shown.length > MAX_TEXT) {
    errors.push(`${where}: текст длиннее ${MAX_TEXT} знаков (${shown.length})`);
  }
}

/** Ошибки data/tutorial.json; пустой список — файл в порядке. */
export function checkTutorial(file: unknown, balance: Balance): string[] {
  const errors: string[] = [];
  if (!isObj(file)) return ['tutorial.json: не объект'];
  if (file.version !== 1) errors.push('tutorial.json: version не 1');
  const speaker = file.speaker;
  if (!isObj(speaker) || typeof speaker.portrait !== 'string' || typeof speaker.name !== 'string') {
    errors.push('tutorial.json: нет speaker.portrait и speaker.name');
  }
  const labels = file.labels;
  for (const k of ['ok', 'skip', 'success', 'welcomeYes', 'welcomeNo']) {
    if (!isObj(labels) || typeof labels[k] !== 'string' || !(labels[k] as string).trim()) {
      errors.push(`tutorial.json: нет labels.${k}`);
    }
  }
  if (!Array.isArray(file.steps) || !file.steps.length) {
    errors.push('tutorial.json: нет steps');
    return errors;
  }
  const ids = new Set<string>();
  file.steps.forEach((step: unknown, i: number) => {
    if (!isObj(step)) {
      errors.push(`шаг ${i + 1}: не объект`);
      return;
    }
    const id = typeof step.id === 'string' && step.id ? step.id : `шаг ${i + 1}`;
    if (id === `шаг ${i + 1}`) errors.push(`${id}: нет id`);
    else if (ids.has(id)) errors.push(`повтор id ${id}`);
    ids.add(id);
    if (!(CHAINS as readonly unknown[]).includes(step.chain))
      errors.push(`${id}: неизвестный chain ${step.chain}`);
    if (!(PHASES as readonly unknown[]).includes(step.phase))
      errors.push(`${id}: неизвестная phase ${step.phase}`);
    if (!DONES.includes(step.done as string)) errors.push(`${id}: неизвестный done ${step.done}`);
    if (step.signal !== undefined) {
      if (!(SIGNALS as readonly unknown[]).includes(step.signal))
        errors.push(`${id}: неизвестный сигнал ${step.signal}`);
      if (step.chain !== 'tip') errors.push(`${id}: сигнал бывает только у tip`);
    }
    if (step.when !== undefined) {
      if (!isObj(step.when)) errors.push(`${id}: when не объект`);
      else
        for (const k of Object.keys(step.when)) {
          if (!REQUIRES_KEYS.includes(k)) errors.push(`${id}: неизвестное условие when.${k}`);
        }
    }
    if (!Array.isArray(step.views) || !step.views.length) {
      errors.push(`${id}: нет views`);
      return;
    }
    step.views.forEach((view: unknown, j: number) => {
      const where = `${id}, вид ${j + 1}`;
      if (!isObj(view)) {
        errors.push(`${where}: не объект`);
        return;
      }
      if (!(ANCHORS as readonly unknown[]).includes(view.target))
        errors.push(`${where}: неизвестный якорь ${view.target}`);
      else if (step.phase === 'morning' && !MORNING_ANCHORS.includes(view.target as string)) {
        errors.push(`${where}: утром цель только в окне события, а не ${view.target}`);
      }
      if (view.ui !== undefined && !UI_STATES.includes(view.ui as string))
        errors.push(`${where}: неизвестный ui ${view.ui}`);
      if (view.layout !== undefined && !(LAYOUTS as readonly unknown[]).includes(view.layout)) {
        errors.push(`${where}: неизвестный layout ${view.layout}`);
      }
      if (view.title !== undefined) checkText(where, 'title', view.title, balance, errors);
      checkText(where, 'text', view.text, balance, errors);
    });
  });
  return errors;
}
