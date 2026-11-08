// Концовки и судьбы персонажей (ТЗ 2.8, 6.9, 10.5). `state.ending` хранит путь финала из выбора дня 20
// (`harbor` | `seal` | `hold`) или уже готовую концовку, которую поставил ночной расчёт (`fall`, `overthrow`).
import { eventText } from './events';
import { checkRequires } from './requires';
import type { Award, Ending, GameData, GameState } from './types';

export interface ResolvedEnding {
  id: string;
  title: string;
  poster?: string;
  /** Текст концовки с абзацами `extraText`, чьи условия выполнены. */
  text: string;
  /** Гавань отказала: текст `harborRefused` перед концовкой. */
  harborRefused?: string;
}

/** Концовки, которые не пересчитываются по показателям. */
const FINAL_IDS = new Set(['fall', 'overthrow', 'schism', 'fortress']);

/** id концовки по ТЗ 6.9 и признак отказа Гавани; `null` — игра не окончена. */
export function endingId(state: GameState, data: GameData): { id: string; harborRefused: boolean } | null {
  const path = state.ending;
  if (!path) return state.stats.trust <= 0 ? { id: 'overthrow', harborRefused: false } : null;
  if (FINAL_IDS.has(path)) return { id: path, harborRefused: false };
  if (state.stats.solidarity < (data.balance.thresholds.solidarityCrisis ?? 0)) {
    return { id: 'schism', harborRefused: false };
  }
  const t = data.balance.endings;
  switch (path) {
    case 'harbor':
      if (state.stats.solidarity >= t.harborSolidarity && !state.flags.includes('dropped_lower')) {
        return { id: 'harbor', harborRefused: false };
      }
      return { id: state.stats.order >= t.fortressOrder ? 'fortress' : 'fall', harborRefused: true };
    case 'seal':
      return { id: state.stats.trust >= t.sealTrust ? 'seal' : 'overthrow', harborRefused: false };
    case 'hold':
      return { id: 'fortress', harborRefused: false };
    default:
      return { id: path, harborRefused: false };
  }
}

/** Концовка для экрана финала; `null`, пока игра не окончена. */
export function resolveEnding(state: GameState, data: GameData): ResolvedEnding | null {
  const resolved = endingId(state, data);
  if (!resolved) return null;
  const ending: Ending | undefined = data.endings.endings.find((e) => e.id === resolved.id);
  if (!ending) throw new Error(`Нет концовки ${resolved.id}`);
  const out: ResolvedEnding = { id: ending.id, title: ending.title, text: eventText(state, ending) };
  if (ending.poster) out.poster = ending.poster;
  if (resolved.harborRefused) out.harborRefused = data.endings.harborRefused;
  return out;
}

/** Судьба каждого персонажа: первая, у которой стоят все флаги, иначе строка с `default`. */
export function characterFates(state: GameState, data: GameData): { who: string; text: string }[] {
  const out: { who: string; text: string }[] = [];
  for (const [who, fates] of Object.entries(data.endings.fates)) {
    const fate =
      fates.find((f) => !f.default && f.flags && checkRequires({ flags: f.flags }, state)) ??
      fates.find((f) => f.default);
    if (fate) out.push({ who, text: fate.text });
  }
  return out;
}

/** Характеристика на Председателя: из каждой группы `reference` первая строка, чьи условия и концовка подходят. */
export function chairReference(state: GameState, data: GameData, endingId: string): string[] {
  const out: string[] = [];
  for (const group of data.endings.reference) {
    const line = group.find(
      (l) => (!l.endings || l.endings.includes(endingId)) && checkRequires(l.requires, state),
    );
    if (line) out.push(line.text);
  }
  return out;
}

/** Значки, заработанные за партию, в порядке файла. */
export function earnedAwards(state: GameState, data: GameData): Award[] {
  return data.endings.awards.filter((a) => checkRequires(a.requires, state));
}
