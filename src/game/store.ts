// Единственное место, где живёт текущее состояние в браузере.
// Сцены Phaser и DOM-панели подписываются на изменения; менять состояние можно только
// через dispatch с чистой функцией из core — так логика остаётся проверяемой без экрана.
import type { GameState } from '../core';

type Listener = (state: GameState) => void;

export class GameStore {
  private listeners = new Set<Listener>();

  constructor(private current: GameState) {}

  get state(): GameState {
    return this.current;
  }

  dispatch(update: (state: GameState) => GameState): void {
    this.current = update(this.current);
    for (const l of this.listeners) l(this.current);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }
}
