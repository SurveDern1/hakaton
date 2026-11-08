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
 * Кнопка «Понятно» есть у шагов для чтения и у тех, где действие — выбор игрока, а не обязанность:
 * выбор ответа (окно события держит Tab внутри себя), стройка и режим двигателя (можно не строить и
 * оставить режим — тогда шаг не должен держать сценарий дня до вечера). Действие закрывает шаг с
 * «Получилось». Без кнопки — переход по вкладке и конец дня: их делают все.
 */
const OK_DONE: readonly TutorialStep['done'][] = ['ok', 'choice', 'built', 'mode'];
export const hasOk = (step: TutorialStep) => OK_DONE.includes(step.done);

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
