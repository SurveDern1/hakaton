// Сохранение одной партии в localStorage (ТЗ 3.2): пишется после каждого утра, читается кнопкой
// «Продолжить». parseSave — чистая функция: битая или чужая запись даёт null, и игра начинается заново.
import type { GameState } from '../core';

export const SAVE_KEY = 'sedmaya.save';
const VERSION = 1;

interface SaveFile {
  version: number;
  savedAt: string;
  state: GameState;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Похоже ли значение на состояние игры: поля, без которых расчёт ночи упадёт. */
export function isGameState(v: unknown): v is GameState {
  if (!isObj(v)) return false;
  const { day, rng, res, stats, factions, tiers } = v;
  if (!isNum(day) || day < 1 || !isNum(rng) || !isNum(v.altitude) || !isNum(v.mist)) return false;
  if (!isObj(res) || !['pop', 'food', 'ether', 'mat'].every((k) => isNum(res[k]))) return false;
  if (!isObj(stats) || !['trust', 'solidarity', 'health', 'order'].every((k) => isNum(stats[k])))
    return false;
  if (!isObj(factions)) return false;
  if (!Array.isArray(tiers) || tiers.length < 2) return false;
  if (!tiers.every((t) => isObj(t) && typeof t.kind === 'string' && Array.isArray(t.slots))) return false;
  const lists = ['decrees', 'modifiers', 'flags', 'scheduled', 'log', 'scars', 'unlocked'];
  return lists.every((k) => Array.isArray(v[k])) && isObj(v.seen) && isObj(v.decreeCooldown);
}

export function serializeSave(state: GameState, now = new Date()): string {
  const file: SaveFile = { version: VERSION, savedAt: now.toISOString(), state };
  return JSON.stringify(file);
}

/** Состояние из записи; null — записи нет, она битая, другой версии или игра в ней окончена. */
export function parseSave(raw: string | null): GameState | null {
  if (!raw) return null;
  try {
    const file: unknown = JSON.parse(raw);
    if (!isObj(file) || file.version !== VERSION || !isGameState(file.state)) return null;
    return file.state.ending ? null : file.state;
  } catch {
    return null;
  }
}

/** Хранилище может быть недоступно (приватный режим, запрет cookies) — тогда игра просто не сохраняется. */
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadGame(): GameState | null {
  try {
    return parseSave(storage()?.getItem(SAVE_KEY) ?? null);
  } catch {
    return null;
  }
}

export function saveGame(state: GameState): boolean {
  try {
    storage()?.setItem(SAVE_KEY, serializeSave(state));
    return true;
  } catch {
    return false;
  }
}

export function clearSave(): void {
  try {
    storage()?.removeItem(SAVE_KEY);
  } catch {
    // нечего удалять
  }
}
