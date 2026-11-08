// Обучение в игре: данные data/tutorial.json, выбор шага (model.ts), прогресс (storage.ts), карточка
// (coach.ts), якоря экрана (anchors.ts). Подключение — initTutorial из src/main.ts.
//
// Порядок вызовов:
// 1. main.ts: initTutorial({ root: #ui, store, loop, data, status }) после mountBuildMenu; прогресс
//    `sedmaya.tutorial` читается (loadProgress, миграция Р2) и сразу записывается.
// 2. Утро: адаптер LoopView.morning в main.ts сперва ждёт beforeMorning(day) — на первом утре это
//    модальное приветствие (coach.welcome), иначе Promise сразу выполнен; потом окна событий.
// 3. Сигналы: loop.onPhase, store.subscribe и MutationObserver на #ui (hidden / class / aria-selected:
//    меню стройки, окно события, вкладки, лист) → evaluate() раз за кадр: контекст buildContext →
//    isDone для показанного шага и кандидата (тогда markDone, saveProgress и «Получилось») →
//    currentStep. Новый шаг показывается, когда он не менялся 500 мс (экран успокоился).
// 4. Ночью, в финале и на старте currentStep пуст — карточка уходит.
// Состояние игры обучение не меняет; откат — убрать initTutorial и ворота утра в main.ts.
import { type GameData, isTierInMist } from '../core';
import type { GameLoop } from '../game/loop';
import type { GameStore } from '../game/store';
import { AVOID_SELECTORS, findAnchor, queryAnchor, REPLY_SELECTOR } from './anchors';
import { type Coach, type CoachSample, mountCoach } from './coach';
import { flowSteps, stepCard, viewKey, WELCOME_ID } from './flow';
import { buildMemo } from './memo';
import { type MemoWindow, mountMemoWindow } from './memo-window';
import {
  buildContext,
  currentStep,
  isDone,
  markDone,
  pickView,
  resetProgress,
  setTutorialOn,
  type TutorialContext,
  type TutorialGamePhase,
  type TutorialProgress,
  type TutorialUi,
  tutorialFile,
} from './model';
import { TABS, type TutorialStep, type TutorialTab } from './schema';
import { loadProgress, saveProgress } from './storage';

export * from './anchors';
export * from './flow';
export * from './memo';
export * from './model';
export * from './place';
export * from './schema';
export * from './storage';

/** Пауза перед показом шага: экран успокоился (фаза, окно, твин камеры). */
export const SETTLE_MS = 500;
/** Раскладка «телефон» — рамка `#app` уже 760 px (как в main.ts и panel.ts). */
const PHONE_MAX = 760;

export interface TutorialOptions {
  root: HTMLElement;
  store: GameStore;
  loop: GameLoop;
  data: GameData;
  status: { say(text: string, tone?: 'good' | 'bad' | 'info'): void };
  /** Рамка экрана, по умолчанию #app. */
  frame?: HTMLElement;
}

export interface Tutorial {
  /** Ворота перед окнами утра: на первом утре — приветствие «Покажи» / «Я разберусь сам». */
  beforeMorning(day: number): Promise<void>;
  /** Пункты меню игры: «Памятка», «Подсказки: вкл/выкл», «Пройти обучение заново». */
  menuItems(close?: () => void): HTMLElement[];
  /** Показать шаг сразу, без условий (отладка, `?tutorial=`); false — нет такого шага. */
  show(id: string): boolean;
  reset(): void;
  /** Отладка `?tutorial=<id>`: прогресс только в памяти, все шаги, кроме этого, пройдены. */
  debug(id: string): TutorialStep | null;
  readonly progress: TutorialProgress;
  /** Показанный шаг. */
  readonly current: string | null;
  readonly samples: CoachSample[];
  readonly coach: Coach;
  /** «Памятка»: пройденные подсказки по разделам (memo.ts, memo-window.ts). */
  readonly memo: { open(): void; close(): void; readonly isOpen: boolean };
}

export function initTutorial(opts: TutorialOptions): Tutorial {
  const { root, store, loop, data, status } = opts;
  const file = tutorialFile;
  const steps = flowSteps(file.steps);
  const welcomeStep = file.steps.find((s) => s.id === WELCOME_ID) ?? null;
  const frame = opts.frame ?? document.getElementById('app') ?? document.body;
  const coach = mountCoach(root, {
    frame,
    voice: file.speaker.name,
    labels: file.labels,
    avoid: [...AVOID_SELECTORS],
  });
  const memoWindow: MemoWindow = mountMemoWindow(root, file.speaker.name);

  let persist = true;
  let progress = loadProgress(file.steps);
  saveProgress(progress);

  let prev: TutorialContext | null = null;
  let lastPhase: TutorialGamePhase = loop.phase;
  let phaseTip: string | null = null;
  let shown: { step: TutorialStep; key: string } | null = null;
  /** Шаг, показанный вручную (show / ?tutorial=): наблюдатель его не убирает. */
  let forced = false;
  let welcoming = false;
  let confirming = false;
  let pending: { key: string; timer: number } | null = null;
  let raf = 0;

  const save = () => {
    if (persist) saveProgress(progress);
  };

  function readUi(): TutorialUi {
    const layout = frame.getBoundingClientRect().width < PHONE_MAX ? 'phone' : 'wide';
    const q = (sel: string) => root.querySelector(sel);
    const tabId = q('.panel .tab[aria-selected="true"]')?.getAttribute('data-tab') ?? null;
    const tab = layout === 'phone' && TABS.includes(tabId as TutorialTab) ? (tabId as TutorialTab) : null;
    return {
      layout,
      menuOpen: !!q('.bmenu:not([hidden])'),
      tab,
      eventOpen: !!q('.ev-layer:not(.is-leaving):not(.report-layer)'),
      reportShown: !!q('.ev-layer:not(.is-leaving) .ev-report, .report-layer .report-list'),
      memoryHint: !!q('.ev-layer:not(.is-chosen) .hint.memory'),
      // Замок с причиной у обоих: is-locked — нужны прошлые решения, is-off — не хватает ресурсов.
      lockedChoice: !!q('.ev-layer:not(.is-chosen) .ev-choice.is-off'),
    };
  }

  const mistTier = () => {
    const s = store.state;
    const i = s.tiers.findIndex((t, k) => !t.abandoned && isTierInMist(s, data.balance, k));
    return i < 0 ? null : i;
  };

  function context(): TutorialContext {
    const phase = loop.phase;
    if (phase !== lastPhase) {
      lastPhase = phase;
      phaseTip = null;
    }
    return buildContext(store.state, data, phase, readUi(), phaseTip);
  }

  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(evaluate);
  };

  function clearPending(): void {
    if (pending) clearTimeout(pending.timer);
    pending = null;
  }

  function drop(): void {
    shown = null;
    forced = false;
    void coach.hide();
  }

  async function complete(step: TutorialStep): Promise<void> {
    progress = markDone(progress, step.id);
    save();
    if (shown?.step.id !== step.id) return;
    confirming = true;
    await coach.confirm(file.labels.success);
    confirming = false;
    shown = null;
    forced = false;
    schedule();
  }

  function display(step: TutorialStep, view = step.views[0]): void {
    if (!view) return;
    clearPending();
    const vars = { mistTier: mistTier() };
    findAnchor(frame, view.target, vars);
    const card = stepCard(file, data.balance, step, view);
    coach.show(
      {
        ...card,
        onOk: () => {
          progress = markDone(progress, step.id);
          save();
          drop();
          schedule();
        },
        onSkip: () => skip(),
      },
      view.target === 'center' ? null : () => queryAnchor(frame, view.target, vars),
    );
    shown = { step, key: viewKey(step, view) };
    if (step.chain === 'tip') phaseTip = step.id;
  }

  function evaluate(): void {
    raf = 0;
    const ctx = context();
    const before = prev;
    prev = ctx;
    if (welcoming || confirming) return;
    if (before) {
      // Действие игрока закрывает показанный шаг и тот, что вот-вот покажется (успел раньше карточки).
      const cand = currentStep(steps, progress, before)?.step;
      for (const step of new Set([shown?.step, cand])) {
        if (!step || step.done === 'ok' || progress.done.includes(step.id)) continue;
        if (isDone(step, before, ctx)) {
          void complete(step);
          if (confirming) return;
        }
      }
    }
    if (forced && shown && (ctx.phase === 'morning' || ctx.phase === 'day')) return;
    const want = progress.on ? currentStep(steps, progress, ctx) : null;
    const key = want ? viewKey(want.step, want.view) : null;
    if (key === shown?.key) {
      clearPending();
      return;
    }
    if (shown) drop();
    if (!want || !key) {
      clearPending();
      return;
    }
    if (pending?.key === key) return;
    clearPending();
    const timer = window.setTimeout(() => {
      pending = null;
      // Реплика персонажа внизу ещё видна — карточка подождёт, чтобы не лечь на неё и не прыгать.
      if (root.querySelector(REPLY_SELECTOR)) {
        schedule();
        return;
      }
      const now = progress.on ? currentStep(steps, progress, context()) : null;
      if (now && viewKey(now.step, now.view) === key && !welcoming && !confirming)
        display(now.step, now.view);
    }, SETTLE_MS);
    pending = { key, timer };
  }

  function skip(): void {
    progress = setTutorialOn(progress, false);
    save();
    clearPending();
    drop();
    status.say('Подсказки выключены. Включить — в меню', 'info');
  }

  async function beforeMorning(day: number): Promise<void> {
    if (!welcomeStep || day > 1 || !progress.on || progress.done.includes(WELCOME_ID)) return;
    const view = welcomeStep.views[0];
    if (!view) return;
    welcoming = true;
    clearPending();
    drop();
    const yes = await coach.welcome(
      { title: view.title, text: view.text, voice: file.speaker.name },
      file.labels.welcomeYes,
      file.labels.welcomeNo,
    );
    welcoming = false;
    progress = markDone(progress, WELCOME_ID);
    if (!yes) progress = setTutorialOn(progress, false);
    save();
    if (!yes) status.say('Подсказки выключены. Включить — в меню', 'info');
    schedule();
  }

  function reset(): void {
    // Приветствие уже было: игрок сам попросил обучение, сразу идут шаги.
    progress = markDone(resetProgress(), WELCOME_ID);
    save();
    phaseTip = null;
    drop();
    status.say('Обучение с начала: подсказки покажутся по ходу игры', 'info');
    schedule();
  }

  function openMemo(): void {
    memoWindow.open(buildMemo(file, data.balance, progress.done, readUi().layout), { off: !progress.on });
  }

  function menuItems(close?: () => void): HTMLElement[] {
    const item = (text: string, onClick: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.className = 'gm-item tut-item';
      b.textContent = text;
      b.addEventListener('click', () => {
        close?.();
        onClick();
      });
      return b;
    };
    return [
      item('Памятка', openMemo),
      item(`Подсказки: ${progress.on ? 'вкл' : 'выкл'}`, () => {
        progress = setTutorialOn(progress, !progress.on);
        save();
        if (!progress.on) drop();
        status.say(progress.on ? 'Подсказки включены' : 'Подсказки выключены', 'info');
        schedule();
      }),
      item('Пройти обучение заново', reset),
    ];
  }

  function show(id: string): boolean {
    const step = file.steps.find((s) => s.id === id);
    if (!step) return false;
    const view = pickView(step, context()) ?? step.views[0];
    forced = true;
    display(step, view);
    return true;
  }

  function debug(id: string): TutorialStep | null {
    const step = file.steps.find((s) => s.id === id) ?? null;
    if (!step) return null;
    persist = false;
    progress = { v: 1, on: true, done: file.steps.filter((s) => s.id !== id).map((s) => s.id) };
    return step;
  }

  loop.onPhase(schedule);
  store.subscribe(schedule);
  // Свои карточка и рамка (.tut-layer) тоже меняют class — их записи не в счёт.
  new MutationObserver((records) => {
    if (records.some((r) => !(r.target instanceof Element && r.target.closest('.tut-layer')))) schedule();
  }).observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['hidden', 'class', 'aria-selected'],
  });
  window.addEventListener('resize', schedule);

  return {
    beforeMorning,
    menuItems,
    show,
    reset,
    debug,
    get progress() {
      return progress;
    },
    get current() {
      return shown?.step.id ?? null;
    },
    get samples() {
      return coach.samples;
    },
    coach,
    memo: {
      open: openMemo,
      close: () => memoWindow.close(),
      get isOpen() {
        return memoWindow.isOpen;
      },
    },
  };
}
