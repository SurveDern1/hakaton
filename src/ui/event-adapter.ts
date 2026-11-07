// ВРЕМЕННЫЙ адаптер событий для окна утра. Заменяется функциями из src/core/events.ts
// одной правкой импорта в event-window.ts: сигнатуры eventText / choiceAvailability /
// previewChoice / applyChoice совпадают с core. Здесь только простое прибавление эффектов,
// без модификаторов башни, концовок и прочих правил ночи — их считает core.

import type {
  Choice,
  EffectKey,
  FactionKey,
  GameData,
  GameEvent,
  GameState,
  Res,
  ResKey,
  StatKey,
} from '../core';
import { checkRequires } from '../core';

export type DeltaKey = EffectKey | FactionKey;

/** Можно ли выбрать вариант. Скрытый вариант не показывается вовсе (ТЗ 6.7). */
export interface ChoiceAvailability {
  visible: boolean;
  enabled: boolean;
  /** Почему закрыт: lockedText или нехватка ресурсов. */
  reason?: string;
  /** Закрыт условием requires (показывается перечёркнутым), а не ценой. */
  locked?: boolean;
}

/** Одна стрелка подсказки: направление и сила 1–3, у фракций — только знак. */
export interface PreviewHint {
  key: DeltaKey;
  kind: 'res' | 'stat' | 'world' | 'faction';
  dir: 1 | -1;
  level: 1 | 2 | 3;
}

export interface ChoicePreview {
  hints: PreviewHint[];
  /** ⧗ это запомнят: у варианта есть отложенные последствия. */
  memory: boolean;
}

export interface ChoiceDelta {
  key: DeltaKey;
  kind: PreviewHint['kind'];
  delta: number;
}

export interface ChoiceResult {
  eventId: string;
  choice: number;
  deltas: ChoiceDelta[];
  reply?: { who: string; text: string };
  log: string;
}

const RES_KEYS: ResKey[] = ['pop', 'food', 'ether', 'mat'];
const STAT_KEYS: StatKey[] = ['trust', 'solidarity', 'health', 'order'];

const RES_GENITIVE: Record<ResKey, string> = {
  pop: 'жителей',
  food: 'еды',
  ether: 'эфира',
  mat: 'материалов',
};

function kindOf(key: DeltaKey): PreviewHint['kind'] {
  if ((RES_KEYS as string[]).includes(key)) return 'res';
  if ((STAT_KEYS as string[]).includes(key)) return 'stat';
  if (key === 'altitude' || key === 'mist') return 'world';
  return 'faction';
}

function findEvent(data: GameData, eventId: string): GameEvent {
  const ev = data.events.find((e) => e.id === eventId);
  if (!ev) throw new Error(`Нет события ${eventId}`);
  return ev;
}

function findChoice(data: GameData, eventId: string, i: number): Choice {
  const c = findEvent(data, eventId).choices[i];
  if (!c) throw new Error(`Нет варианта ${i} у события ${eventId}`);
  return c;
}

/** Текст события: основной абзац и подходящие extraText, абзацы через пустую строку. */
export function eventText(state: GameState, event: GameEvent): string {
  const parts = [event.text];
  for (const extra of event.extraText ?? []) {
    if (checkRequires(extra.requires, state)) parts.push(extra.text);
  }
  return parts.join('\n\n');
}

export function choiceAvailability(state: GameState, choice: Choice): ChoiceAvailability {
  if (!checkRequires(choice.requires, state)) {
    if (!choice.lockedText) return { visible: false, enabled: false };
    return { visible: true, enabled: false, locked: true, reason: choice.lockedText };
  }
  for (const [k, need] of Object.entries(choice.cost ?? {}) as [ResKey, number][]) {
    if (need > 0 && state.res[k] < need) {
      return { visible: true, enabled: false, reason: `Нужно ${need} ${RES_GENITIVE[k]}` };
    }
  }
  return { visible: true, enabled: true };
}

function level(abs: number, steps: number[]): 1 | 2 | 3 {
  if (abs >= (steps[2] ?? Number.POSITIVE_INFINITY)) return 3;
  if (abs >= (steps[1] ?? Number.POSITIVE_INFINITY)) return 2;
  return 1;
}

/** Сумма эффектов варианта: effects минус cost; для подсказки и для применения. */
function choiceTotals(choice: Choice): Map<EffectKey, number> {
  const totals = new Map<EffectKey, number>();
  for (const [k, v] of Object.entries(choice.effects ?? {}) as [EffectKey, number][]) {
    totals.set(k, (totals.get(k) ?? 0) + v);
  }
  for (const [k, v] of Object.entries(choice.cost ?? {}) as [ResKey, number][]) {
    totals.set(k, (totals.get(k) ?? 0) - v);
  }
  return totals;
}

/** Подсказка до выбора (ТЗ 6.7): стрелки из effects/cost, фракции от порога, ⧗ за флаги и delayed. */
export function previewChoice(_state: GameState, data: GameData, eventId: string, i: number): ChoicePreview {
  const choice = findChoice(data, eventId, i);
  const { statSteps, resSteps, factionPortraitMin } = data.balance.preview;
  const hints: PreviewHint[] = [];
  for (const [key, v] of choiceTotals(choice)) {
    if (!v) continue;
    const kind = kindOf(key);
    hints.push({
      key,
      kind,
      dir: v > 0 ? 1 : -1,
      level: level(Math.abs(v), kind === 'res' ? resSteps : statSteps),
    });
  }
  for (const [key, v] of Object.entries(choice.factions ?? {}) as [FactionKey, number][]) {
    if (Math.abs(v) >= factionPortraitMin)
      hints.push({ key, kind: 'faction', dir: v > 0 ? 1 : -1, level: 1 });
  }
  const memory =
    Boolean(choice.setFlags?.length) || Boolean(choice.delayed?.length) || Boolean(choice.modifiers?.length);
  return { hints, memory };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Применить выбор простым прибавлением: цена, эффекты, фракции, флаги, отложенные события, журнал. */
export function applyChoice(
  state: GameState,
  data: GameData,
  eventId: string,
  i: number,
): { state: GameState; result: ChoiceResult } {
  const choice = findChoice(data, eventId, i);
  const totals = choiceTotals(choice);
  for (const extra of choice.extraEffects ?? []) {
    if (!checkRequires(extra.requires, state)) continue;
    for (const [k, v] of Object.entries(extra.effects ?? {}) as [EffectKey, number][]) {
      totals.set(k, (totals.get(k) ?? 0) + v);
    }
  }

  const res: Res = { ...state.res };
  const stats = { ...state.stats };
  const factions = { ...state.factions };
  let { altitude, mist } = state;
  const deltas: ChoiceDelta[] = [];
  const push = (key: DeltaKey, before: number, after: number) => {
    if (after !== before) deltas.push({ key, kind: kindOf(key), delta: after - before });
  };

  for (const [key, v] of totals) {
    if (!v) continue;
    if ((RES_KEYS as string[]).includes(key)) {
      const k = key as ResKey;
      const next = Math.max(0, res[k] + v);
      push(k, res[k], next);
      res[k] = next;
    } else if ((STAT_KEYS as string[]).includes(key)) {
      const k = key as StatKey;
      const next = clamp(stats[k] + v, 0, 100);
      push(k, stats[k], next);
      stats[k] = next;
    } else if (key === 'altitude') {
      push(key, altitude, altitude + v);
      altitude += v;
    } else if (key === 'mist') {
      push(key, mist, mist + v);
      mist += v;
    }
  }
  const [fMin, fMax] = data.balance.factions.range;
  for (const [k, v] of Object.entries(choice.factions ?? {}) as [FactionKey, number][]) {
    const next = clamp(factions[k] + v, fMin, fMax);
    push(k, factions[k], next);
    factions[k] = next;
  }

  const clear = new Set(choice.clearFlags ?? []);
  const flags = [...new Set([...state.flags.filter((f) => !clear.has(f)), ...(choice.setFlags ?? [])])];
  const scheduled = [
    ...state.scheduled,
    ...(choice.delayed ?? []).map((d) => ({ day: state.day + d.inDays, event: d.event })),
  ];
  const modifiers = [...state.modifiers, ...(choice.modifiers ?? []).map((m) => ({ ...m, left: m.nights }))];

  const next: GameState = {
    ...state,
    res,
    stats,
    factions,
    altitude,
    mist,
    flags,
    scheduled,
    modifiers,
    seen: { ...state.seen, [eventId]: state.day },
    log: [...state.log, { day: state.day, text: choice.log }],
  };
  return {
    state: next,
    result: { eventId, choice: i, deltas, reply: choice.reply, log: choice.log },
  };
}
