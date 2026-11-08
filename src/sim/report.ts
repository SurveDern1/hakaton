// Сводка прогонов для `npm run sim`: концовки по стратегиям, запас до Падения, нехватки,
// а по всем партиям вместе — события, варианты, флаги и концовки, которые ни разу не встретились.
import { gameData } from '../core';
import type { GameData } from '../core/types';
import { type SimResult, type Strategy, simulate } from './sim';
import { STRATEGIES } from './strategies';

export interface RunOptions {
  seeds: number;
  /** Стратегии по id; пусто — все. */
  only?: string[];
  /** Показать по дням партию этой стратегии с первым сидом. */
  trace?: string;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const fmt = (x: number) => (Math.round(x * 10) / 10).toString();

export function runAll(data: GameData, strategies: Strategy[], seeds: number): Map<string, SimResult[]> {
  const out = new Map<string, SimResult[]>();
  for (const st of strategies) {
    const runs: SimResult[] = [];
    for (let seed = 1; seed <= seeds; seed++) runs.push(simulate(data, st, seed));
    out.set(st.id, runs);
  }
  return out;
}

function strategyBlock(st: Strategy, runs: SimResult[]): string[] {
  const endings = new Map<string, number>();
  for (const r of runs) {
    const key = r.harborRefused ? `${r.ending} (Гавань отказала)` : r.ending;
    endings.set(key, (endings.get(key) ?? 0) + 1);
  }
  const lost = runs.filter((r) => r.lastDay < 20);
  const stat = (k: keyof SimResult['final']['stats']) => fmt(avg(runs.map((r) => r.final.stats[k])));
  const res = (k: keyof SimResult['final']['res']) => fmt(avg(runs.map((r) => r.final.res[k])));
  return [
    `## ${st.name} (${st.id}), партий: ${runs.length}`,
    `Концовки: ${[...endings].map(([k, n]) => `${k} ×${n}`).join(', ')}`,
    lost.length
      ? `Проиграли раньше дня 20: ${lost.length}, дни: ${lost.map((r) => r.lastDay).join(', ')}`
      : 'Все дошли до дня 20',
    `Итог в среднем: доверие ${stat('trust')}, сплочённость ${stat('solidarity')}, здоровье ${stat('health')}, порядок ${stat('order')}`,
    `Ресурсы: жители ${res('pop')}, еда ${res('food')}, эфир ${res('ether')}, материалы ${res('mat')}; ярусов ${fmt(avg(runs.map((r) => r.final.tiers)))}`,
    `Запас до Падения: в конце ${fmt(avg(runs.map((r) => r.final.spireGap)))} м, минимум ${fmt(Math.min(...runs.map((r) => r.minSpireGap)))} м`,
    `За партию: голодных ночей ${fmt(avg(runs.map((r) => r.foodShortageNights)))}, ночей без эфира ${fmt(avg(runs.map((r) => r.etherShortfallNights)))}, умерло ${fmt(avg(runs.map((r) => r.deaths)))}, заброшено ярусов ${fmt(avg(runs.map((r) => r.abandonedTiers)))}, кристаллов ${fmt(avg(runs.map((r) => r.final.memories)))}`,
  ];
}

/** Что не встретилось ни в одной партии: события, варианты, флаги из setFlags, концовки. */
export function coverage(data: GameData, all: SimResult[]) {
  const seenEvents = new Set(all.flatMap((r) => r.picks.map((p) => p.id)));
  const seenChoices = new Set(all.flatMap((r) => r.picks.map((p) => `${p.id}#${p.choice}`)));
  const seenFlags = new Set(all.flatMap((r) => r.final.flags));
  const endings = new Set(all.map((r) => r.ending));
  const flagsInData = new Set(data.events.flatMap((e) => e.choices.flatMap((c) => c.setFlags ?? [])));
  return {
    events: data.events.map((e) => e.id).filter((id) => !seenEvents.has(id)),
    choices: data.events.flatMap((e) =>
      e.choices.flatMap((_, i) =>
        seenEvents.has(e.id) && !seenChoices.has(`${e.id}#${i}`) ? [`${e.id}#${i}`] : [],
      ),
    ),
    flags: [...flagsInData].filter((f) => !seenFlags.has(f)),
    endings: data.endings.endings.map((e) => e.id).filter((id) => !endings.has(id)),
    reached: [...endings],
  };
}

function traceBlock(r: SimResult): string[] {
  const lines = [`## По дням: ${r.strategy}, сид ${r.seed} → ${r.ending}`];
  lines.push('день | жит еда эфир мат | дов спл здр пор | выс Мгла запас | события | действия | ночь');
  for (const d of r.trace) {
    const n = d.night;
    const night = n
      ? [
          n.foodShortage ? 'голод' : '',
          n.etherShortfall ? `эфир −${Math.round(n.etherShortfall * 100)}%` : '',
          n.deaths ? `умерло ${n.deaths}` : '',
          n.abandoned.length ? 'ярус брошен' : '',
          n.tierBuilt ? 'новый ярус' : '',
          n.sabotage ? 'диверсия' : '',
        ]
          .filter(Boolean)
          .join(', ')
      : '';
    lines.push(
      [
        String(d.day).padStart(2),
        `${d.res.pop} ${d.res.food} ${d.res.ether} ${d.res.mat}`,
        `${d.stats.trust} ${d.stats.solidarity} ${d.stats.health} ${d.stats.order}`,
        `${d.altitude} ${d.mist} ${d.spireGap}${d.rootInMist ? ' Корень в Мгле' : ''}`,
        d.events.map((e) => `${e.id}#${e.choice}`).join(' '),
        d.actions.join(' '),
        night,
      ].join(' | '),
    );
  }
  return lines;
}

/** Текст отчёта для консоли. */
export function report(options: RunOptions, data: GameData = gameData): string {
  const strategies = options.only?.length
    ? STRATEGIES.filter((s) => options.only?.includes(s.id))
    : STRATEGIES;
  const results = runAll(data, strategies, options.seeds);
  const lines: string[] = [`# Прогон баланса: ${options.seeds} сидов на стратегию`, ''];
  for (const st of strategies) lines.push(...strategyBlock(st, results.get(st.id) ?? []), '');
  const cov = coverage(data, [...results.values()].flat());
  lines.push('## Покрытие по всем партиям');
  lines.push(`Достигнутые концовки: ${cov.reached.join(', ')}`);
  lines.push(`Ни разу не достигнуты: ${cov.endings.join(', ') || '—'}`);
  lines.push(`События, которые ни разу не выпали (${cov.events.length}): ${cov.events.join(', ') || '—'}`);
  lines.push(`Варианты, которые никто не выбрал (${cov.choices.length}): ${cov.choices.join(', ') || '—'}`);
  lines.push(`Флаги, которые ни разу не поставлены (${cov.flags.length}): ${cov.flags.join(', ') || '—'}`);
  if (options.trace) {
    const run = results.get(options.trace)?.[0];
    if (run) lines.push('', ...traceBlock(run));
  }
  return lines.join('\n');
}
