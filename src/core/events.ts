// Очередь событий утра (ТЗ 6.8) и текст события с абзацами по условиям (ТЗ 10.3, extraText).
// Порядок: сюжетное дня → отложенные на сегодня → кризис порога → случайное из пула.
import { checkRequires } from './requires';
import { pickWeighted } from './rng';
import type { GameData, GameEvent, GameState, Requires } from './types';

export interface MorningQueue {
  state: GameState;
  /** id событий в порядке показа. */
  queue: string[];
}

export function findEvent(data: GameData, id: string): GameEvent {
  const event = data.events.find((e) => e.id === id);
  if (!event) throw new Error(`Нет события ${id}`);
  return event;
}

/** Показано ли событие за последние `gap` дней (включая сегодня). */
const shownRecently = (state: GameState, id: string, gap: number): boolean => {
  const day = state.seen[id];
  return day !== undefined && state.day - day <= gap;
};

/** Пересечён ли порог, при котором утром приходит кризис (ТЗ 4.2, 4.6). */
export function crisisThresholdCrossed(state: GameState, data: GameData): boolean {
  const { thresholds, factions } = data.balance;
  if (thresholds.trustRumors !== undefined && state.stats.trust < thresholds.trustRumors) return true;
  if (thresholds.solidarityCrisis !== undefined && state.stats.solidarity < thresholds.solidarityCrisis)
    return true;
  return Object.values(state.factions).some((v) => Math.abs(v) >= factions.eventAt);
}

/**
 * Собирает очередь утра для `state.day`. Отложенные события на сегодня снимаются из `state.scheduled`;
 * те, что не влезли в лимит окон, переносятся на завтра (сюжетное событие всегда показывается).
 * Случайное событие выбирается через `state.rng`, поэтому один сид даёт одну и ту же игру.
 */
export function buildMorningQueue(state: GameState, data: GameData): MorningQueue {
  const { maxWindowsPerMorning: maxWindows, poolRepeatGapDays: gap } = data.balance.events;
  const next: GameState = { ...state, scheduled: [] };
  const queue: string[] = [];
  const carry: string[] = [];
  const holds = (req: Requires | undefined) => checkRequires(req, state);

  // 1. Сюжетное событие дня: первое по порядку в файле с выполненным requires.
  const story = data.events.find(
    (e) => e.day === state.day && state.seen[e.id] === undefined && holds(e.requires),
  );
  if (story) queue.push(story.id);

  // 2. Отложенные на сегодня (и не показанные раньше); requires не выполнено — отмена.
  for (const item of state.scheduled) {
    if (item.day > state.day) {
      next.scheduled.push(item);
      continue;
    }
    const event = data.events.find((e) => e.id === item.event);
    if (!event || !holds(event.requires) || queue.includes(event.id) || carry.includes(event.id)) continue;
    (queue.length < maxWindows ? queue : carry).push(event.id);
  }

  // 3. Кризис порога из pool "crisis": первый подходящий по порядку в файле.
  if (crisisThresholdCrossed(state, data)) {
    const crisis = data.events.find(
      (e) =>
        e.pool === 'crisis' &&
        !queue.includes(e.id) &&
        !carry.includes(e.id) &&
        !(e.once && state.seen[e.id] !== undefined) &&
        !shownRecently(state, e.id, gap) &&
        holds(e.requires),
    );
    if (crisis) (queue.length < maxWindows ? queue : carry).push(crisis.id);
  }

  // 4. Случайное из pool "common" — только если осталось место.
  if (queue.length < maxWindows) {
    const pool = data.events.filter(
      (e) =>
        e.pool === 'common' &&
        !queue.includes(e.id) &&
        !(e.once && state.seen[e.id] !== undefined) &&
        !shownRecently(state, e.id, gap) &&
        holds(e.requires),
    );
    if (pool.length > 0) {
      const [index, rng] = pickWeighted(
        state.rng,
        pool.map((e) => e.weight ?? 1),
      );
      next.rng = rng;
      const picked = pool[index];
      if (picked) queue.push(picked.id);
    }
  }

  for (const id of carry) next.scheduled.push({ day: state.day + 1, event: id });
  return { state: next, queue };
}

/** Текст события и абзацы `extraText`, чьи условия выполнены; абзацы разделены пустой строкой. */
export function eventText(state: GameState, event: Pick<GameEvent, 'text' | 'extraText'>): string {
  const parts = [event.text];
  for (const extra of event.extraText ?? []) {
    if (checkRequires(extra.requires, state)) parts.push(extra.text);
  }
  return parts.join('\n\n');
}
