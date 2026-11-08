// Обучение: какой шаг показать и когда он пройден. Чистые функции без DOM.
// Цепочка (срез 3): экран наблюдается → buildContext(состояние, фаза, ui) → currentStep(шаги, прогресс,
// контекст) → карточка; на следующем изменении isDone(шаг, было, стало) → markDone → saveProgress.
// Состояние игры обучение не меняет: прогресс хранится отдельно (storage.ts).
import tutorialJson from '../../data/tutorial.json';
import type { GameData, GameState, StatKey } from '../core';
import { checkRequires, forecastNight, forecastWarnings, isTierInMist, residentsByTier } from '../core';
import {
  MORNING_ANCHORS,
  type TutorialDone,
  type TutorialFile,
  type TutorialLayout,
  type TutorialSignal,
  type TutorialStep,
  type TutorialTab,
  type TutorialView,
} from './schema';

export const tutorialFile = tutorialJson as unknown as TutorialFile;

/** Фаза цикла, как в GameLoop (src/game/loop.ts). */
export type TutorialGamePhase = 'start' | 'morning' | 'day' | 'night' | 'final';

/** Что сейчас на экране: собирает наблюдатель за `#ui` (срез 3). */
export interface TutorialUi {
  layout: TutorialLayout;
  /** Открыто меню стройки. */
  menuOpen: boolean;
  /** Выбранная вкладка нижней панели; на широкой раскладке вкладок нет — null. */
  tab: TutorialTab | null;
  eventOpen: boolean;
  /** В окне события виден отчёт о ночи. */
  reportShown: boolean;
  /** В окне события есть значок «⧗ это запомнят». */
  memoryHint: boolean;
  /** В окне события есть недоступный ответ. */
  lockedChoice: boolean;
}

export const DEFAULT_UI: TutorialUi = {
  layout: 'phone',
  menuOpen: false,
  tab: null,
  eventOpen: false,
  reportShown: false,
  memoryHint: false,
  lockedChoice: false,
};

export interface TutorialContext {
  phase: TutorialGamePhase;
  state: GameState;
  ui: TutorialUi;
  signals: TutorialSignal[];
  /** Подсказка `tip`, уже показанная в эту фазу: больше одной за фазу не бывает. */
  phaseTip: string | null;
}

/** Прогресс: ключ `sedmaya.tutorial` (storage.ts). */
export interface TutorialProgress {
  v: 1;
  on: boolean;
  done: string[];
}

/** Порог беды показателя (balance.thresholds): ниже него начинаются слухи, раскол, смерти, кражи. */
const STAT_THRESHOLD: Record<StatKey, string> = {
  trust: 'trustRumors',
  solidarity: 'solidarityCrisis',
  health: 'healthDeaths',
  order: 'orderTheft',
};

/** Случаи, о которых стоит сказать: по состоянию, прогнозу ночи и экрану. */
export function tutorialSignals(
  state: GameState,
  data: GameData,
  phase: TutorialGamePhase,
  ui: TutorialUi,
): TutorialSignal[] {
  const b = data.balance;
  const out: TutorialSignal[] = [];
  if (phase === 'day' && forecastWarnings(forecastNight(state, data)).length) out.push('alarm');
  if (residentsByTier(state, b).homeless > 0) out.push('homeless');
  if (state.tiers.some((t, i) => !t.abandoned && isTierInMist(state, b, i))) out.push('tierInMist');
  const low = (Object.keys(STAT_THRESHOLD) as StatKey[]).some((k) => {
    const limit = b.thresholds[STAT_THRESHOLD[k]];
    return limit !== undefined && state.stats[k] <= limit;
  });
  if (low) out.push('statLow');
  const firstDecreeDay = Math.min(...Object.values(b.decrees.list).map((d) => d.fromDay));
  if (Object.values(b.decrees.list).some((d) => d.fromDay > firstDecreeDay && d.fromDay <= state.day)) {
    out.push('newDecrees');
  }
  if (ui.lockedChoice) out.push('lockedChoice');
  if (ui.memoryHint) out.push('memoryHint');
  return out;
}

export function buildContext(
  state: GameState,
  data: GameData,
  phase: TutorialGamePhase,
  ui: Partial<TutorialUi> = {},
  phaseTip: string | null = null,
): TutorialContext {
  const full = { ...DEFAULT_UI, ...ui };
  return { phase, state, ui: full, signals: tutorialSignals(state, data, phase, full), phaseTip };
}

function uiMatches(view: TutorialView, ctx: TutorialContext): boolean {
  if (view.layout && view.layout !== ctx.ui.layout) return false;
  if (ctx.phase === 'morning' && !MORNING_ANCHORS.includes(view.target)) return false;
  switch (view.ui) {
    case undefined:
      return true;
    case 'menuOpen':
      return ctx.ui.menuOpen;
    case 'menuClosed':
      return !ctx.ui.menuOpen;
    case 'eventOpen':
      return ctx.ui.eventOpen;
    case 'reportShown':
      return ctx.ui.reportShown;
    case 'memoryHint':
      return ctx.ui.memoryHint;
    case 'lockedChoice':
      return ctx.ui.lockedChoice;
    default:
      return ctx.ui.tab === view.ui.slice('tab:'.length);
  }
}

/** Первый подходящий вид шага или null. */
export function pickView(step: TutorialStep, ctx: TutorialContext): TutorialView | null {
  return step.views.find((v) => uiMatches(v, ctx)) ?? null;
}

function eligible(step: TutorialStep, ctx: TutorialContext): boolean {
  return step.phase === ctx.phase && checkRequires(step.when, ctx.state);
}

/**
 * Что показать сейчас. Сначала первый непройденный шаг сценария `first`, у которого выполнено `when`
 * и подходит вид. Иначе — подсказка `tip` с сработавшим сигналом, не больше одной за фазу: пока она
 * не пройдена, показывается она же, после — ничего до следующей фазы.
 */
export function currentStep(
  steps: readonly TutorialStep[],
  progress: TutorialProgress,
  ctx: TutorialContext,
): { step: TutorialStep; view: TutorialView } | null {
  if (!progress.on || (ctx.phase !== 'morning' && ctx.phase !== 'day')) return null;
  const done = new Set(progress.done);
  for (const step of steps) {
    if (step.chain !== 'first' || done.has(step.id) || !eligible(step, ctx)) continue;
    const view = pickView(step, ctx);
    if (view) return { step, view };
  }
  if (ctx.phaseTip) {
    const step = steps.find((s) => s.id === ctx.phaseTip);
    if (!step || done.has(step.id) || step.phase !== ctx.phase) return null;
    const view = pickView(step, ctx);
    return view ? { step, view } : null;
  }
  for (const step of steps) {
    if (step.chain !== 'tip' || done.has(step.id) || !eligible(step, ctx)) continue;
    if (step.signal && !ctx.signals.includes(step.signal)) continue;
    const view = pickView(step, ctx);
    if (view) return { step, view };
  }
  return null;
}

const buildingsCount = (s: GameState) =>
  s.tiers.reduce((n, t) => n + (t.abandoned ? 0 : t.slots.filter(Boolean).length), 0);

/** Закрыло ли действие игрока шаг: по разнице двух контекстов. `ok` закрывает только кнопка. */
export function isDone(step: TutorialStep, prev: TutorialContext, next: TutorialContext): boolean {
  const done: TutorialDone = step.done;
  switch (done) {
    case 'ok':
      return false;
    case 'built':
      return buildingsCount(next.state) > buildingsCount(prev.state);
    case 'menuOpen':
      return next.ui.menuOpen && !prev.ui.menuOpen;
    case 'mode':
      return next.state.engineMode !== prev.state.engineMode;
    case 'tier':
      return (
        (!prev.state.building && !!next.state.building) || next.state.tiers.length > prev.state.tiers.length
      );
    case 'night':
      return (next.phase === 'night' && prev.phase !== 'night') || next.state.day > prev.state.day;
    case 'choice':
      return next.state.log.length > prev.state.log.length;
    default: {
      const tab = done.slice('tab:'.length);
      return next.ui.tab === tab && prev.ui.tab !== tab;
    }
  }
}

export function markDone(progress: TutorialProgress, id: string): TutorialProgress {
  return progress.done.includes(id) ? progress : { ...progress, done: [...progress.done, id] };
}

/** «Подсказки: вкл/выкл» и «Пропустить». */
export function setTutorialOn(progress: TutorialProgress, on: boolean): TutorialProgress {
  return { ...progress, on };
}

/** «Пройти обучение заново»: всё с начала и включено. */
export function resetProgress(): TutorialProgress {
  return { v: 1, on: true, done: [] };
}

/** Шаги сценария первых дней: их помечает пройденными миграция у тех, кто уже играл (Р2). */
export const firstChainIds = (steps: readonly TutorialStep[]): string[] =>
  steps.filter((s) => s.chain === 'first').map((s) => s.id);
