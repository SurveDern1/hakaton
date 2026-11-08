// Обучение: что именно показать в карточке шага. Чистые функции без DOM — их проверяет flow.test.ts,
// вызывает index.ts (подключение к игре).
import type { Balance } from '../core/types';
import { fillText, type TutorialFile, type TutorialStep, type TutorialView } from './schema';

/** Приветствие первого утра: отдельное модальное окно до окон событий, а не карточка сценария. */
export const WELCOME_ID = 'welcome';

/** Шаги, которые идут через наблюдатель (всё, кроме приветствия). */
export const flowSteps = (steps: readonly TutorialStep[]) => steps.filter((s) => s.id !== WELCOME_ID);

/** «3 из 11» для шага сценария первых дней (без приветствия); у подсказки по случаю — без счёта. */
export function stepCount(steps: readonly TutorialStep[], id: string): string | undefined {
  const first = flowSteps(steps).filter((s) => s.chain === 'first');
  const i = first.findIndex((s) => s.id === id);
  return i < 0 ? undefined : `${i + 1} из ${first.length}`;
}

/**
 * У шага-действия кнопки «Понятно» нет: карточку закрывает само действие. Исключение — выбор ответа
 * в окне события: окно держит Tab внутри себя, поэтому кнопка есть, а выбор тоже закрывает шаг.
 */
export const hasOk = (step: TutorialStep) => step.done === 'ok' || step.done === 'choice';

export interface StepCard {
  title?: string;
  text: string;
  count?: string;
  voice: string;
  ok: string | false;
  skip: string;
}

export function stepCard(
  file: TutorialFile,
  balance: Balance,
  step: TutorialStep,
  view: TutorialView,
): StepCard {
  return {
    title: view.title,
    text: fillText(view.text, balance),
    count: stepCount(file.steps, step.id),
    voice: file.speaker.name,
    ok: hasOk(step) ? file.labels.ok : false,
    skip: file.labels.skip,
  };
}

/** Ключ показанного: тот же шаг в том же виде не пересоздаётся. */
export const viewKey = (step: TutorialStep, view: TutorialView) => `${step.id}#${step.views.indexOf(view)}`;

/** День для `?tutorial=<id>`: из `when.minDay`, иначе первый. */
export const debugDay = (step: TutorialStep) => Math.max(1, step.when?.minDay ?? 1);
