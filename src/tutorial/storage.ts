// Прогресс обучения в localStorage, отдельно от партии: ключ `sedmaya.tutorial`, `{ v: 1, on, done }`.
// parseProgress и migrateProgress чистые; обёртка над localStorage молчит, если хранилище недоступно.
import { SAVE_KEY } from '../game/save';
import { firstChainIds, resetProgress, type TutorialProgress } from './model';
import type { TutorialStep } from './schema';

export const TUTORIAL_KEY = 'sedmaya.tutorial';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Прогресс из записи; битая, чужая или другой версии — значения по умолчанию. */
export function parseProgress(raw: string | null): TutorialProgress {
  if (!raw) return resetProgress();
  try {
    const p: unknown = JSON.parse(raw);
    if (!isObj(p) || p.v !== 1 || typeof p.on !== 'boolean' || !Array.isArray(p.done)) {
      return resetProgress();
    }
    const done = [...new Set(p.done.filter((x): x is string => typeof x === 'string'))];
    return { v: 1, on: p.on, done };
  } catch {
    return resetProgress();
  }
}

/**
 * Прогресс при запуске (Р2). Записи обучения нет, а партия сохранена — игрок уже играл:
 * подсказки включены, сценарий первых дней пройден, подсказки по случаю остаются.
 */
export function migrateProgress(
  raw: string | null,
  hasSave: boolean,
  steps: readonly TutorialStep[],
): TutorialProgress {
  if (raw === null && hasSave) return { v: 1, on: true, done: firstChainIds(steps) };
  return parseProgress(raw);
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadProgress(steps: readonly TutorialStep[]): TutorialProgress {
  try {
    const s = storage();
    return migrateProgress(s?.getItem(TUTORIAL_KEY) ?? null, !!s?.getItem(SAVE_KEY), steps);
  } catch {
    return resetProgress();
  }
}

export function saveProgress(progress: TutorialProgress): boolean {
  try {
    storage()?.setItem(TUTORIAL_KEY, JSON.stringify(progress));
    return true;
  } catch {
    return false;
  }
}
