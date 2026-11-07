// Цикл дня (ТЗ 3, 3.1) поверх core: утро → день → ночь → утро … → финал.
// Порядок: newGame/continueGame → morning(): buildMorningQueue, окна событий через view.morning,
// сохранение (ТЗ 3.2) → фаза «день»: действия через act() → endDay(): runNight, анимация через
// view.night (состояние подменяется посередине анимации) → поражение или финал дня 20 → finish(),
// иначе снова morning(). Сохранение — после утра и после каждого действия дня.
// День 20 без ночи: после его события сразу финал.
import {
  type ActionResult,
  buildMorningQueue,
  createInitialState,
  type GameData,
  type GameState,
  type NightReport,
  runNight,
} from '../core';
import { clearSave, saveGame } from './save';
import type { GameStore } from './store';

export type Phase = 'start' | 'morning' | 'day' | 'night' | 'final';

/** Что цикл просит у экрана. В тестах — заглушки без DOM. */
export interface LoopView {
  /** Утро: отчёт о ночи (null в первый день) и окна событий по очереди; выборы — через store. */
  morning(queue: string[], report: NightReport | null): Promise<void>;
  /** Ночь: анимация; commit() подменяет состояние на утреннее — экран вызывает его, когда Мгле пора подняться. */
  night(report: NightReport, commit: () => void): Promise<void>;
}

type PhaseListener = (phase: Phase) => void;

export class GameLoop {
  private current: Phase = 'start';
  private listeners = new Set<PhaseListener>();
  /** Последний отчёт о ночи: для стенгазеты и утреннего окна. */
  lastReport: NightReport | null = null;

  constructor(
    private store: GameStore,
    private data: GameData,
    private view: LoopView,
  ) {}

  get phase(): Phase {
    return this.current;
  }

  onPhase(listener: PhaseListener): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }

  private setPhase(phase: Phase): void {
    this.current = phase;
    for (const l of this.listeners) l(phase);
  }

  /** Новая партия с первого утра. */
  newGame(seed: number | string = Date.now()): Promise<void> {
    clearSave();
    this.lastReport = null;
    this.store.dispatch(() => createInitialState(this.data.balance, seed));
    return this.morning(null);
  }

  /** Сохранённая партия: сохранение сделано после утра, поэтому продолжаем с дня. */
  continueGame(state: GameState): void {
    this.lastReport = null;
    this.store.dispatch(() => state);
    this.setPhase(state.ending ? 'final' : 'day');
  }

  /** Действие дня (стройка, декрет, двигатель): только днём; при отказе состояние не меняется. */
  act(action: (state: GameState) => ActionResult): ActionResult {
    if (this.current !== 'day') return { ok: false, reason: 'Сейчас не время' };
    const result = action(this.store.state);
    if (result.ok) {
      this.store.dispatch(() => result.state);
      // Сверх ТЗ 3.2: стройка и декреты дня не теряются при перезагрузке
      saveGame(result.state);
    }
    return result;
  }

  /** «Завершить день»: ночь, затем утро или финал. */
  async endDay(): Promise<void> {
    if (this.current !== 'day') return;
    if (this.store.state.day >= this.data.balance.calendar.days) {
      // Последний день без ночи; если путь не выбран, башня держится дальше одна.
      this.store.dispatch((s) => ({ ...s, ending: s.ending ?? 'hold' }));
      this.finish();
      return;
    }
    this.setPhase('night');
    const { state, report } = runNight(this.store.state, this.data);
    this.lastReport = report;
    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      this.store.dispatch(() => state);
    };
    await this.view.night(report, commit);
    commit();
    if (state.ending) {
      this.finish();
      return;
    }
    await this.morning(report);
  }

  private async morning(report: NightReport | null): Promise<void> {
    this.setPhase('morning');
    const { state, queue } = buildMorningQueue(this.store.state, this.data);
    this.store.dispatch(() => state);
    await this.view.morning(queue, report);
    if (this.store.state.ending) {
      this.finish();
      return;
    }
    saveGame(this.store.state);
    this.setPhase('day');
  }

  private finish(): void {
    clearSave();
    this.setPhase('final');
  }
}
