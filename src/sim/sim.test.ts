import { describe, expect, it } from 'vitest';
import { gameData } from '../core';
import { coverage, runAll } from './report';
import { simulate } from './sim';
import { harsh, idle, merciful, pragmatic, randomPlayer, STRATEGIES, seeker } from './strategies';

// Критерии демо из ТЗ 14: прогон без браузера по стратегиям даёт разные концовки, «ничего не строит» проигрывает.
describe('прогон баланса', () => {
  const seeds = [1, 2, 3, 4, 5];
  const endingsOf = (s: typeof merciful) => new Set(seeds.map((seed) => simulate(gameData, s, seed).ending));

  it('та же стратегия и сид дают ту же партию', () => {
    expect(simulate(gameData, randomPlayer, 7)).toEqual(simulate(gameData, randomPlayer, 7));
  });

  it('«ничего не строит» проигрывает до дня 20', () => {
    for (const seed of seeds) {
      const r = simulate(gameData, idle, seed);
      expect(['fall', 'overthrow']).toContain(r.ending);
      expect(r.lastDay).toBeLessThan(gameData.balance.calendar.days);
    }
  });

  it('милосердный, жёсткий, прагматик и ищущий правду приходят к разным концовкам', () => {
    const m = endingsOf(merciful);
    const h = endingsOf(harsh);
    const p = endingsOf(pragmatic);
    const s = endingsOf(seeker);
    expect(m).toEqual(new Set(['harbor']));
    expect(p).toEqual(new Set(['fortress']));
    expect(s).toEqual(new Set(['seal']));
    for (const e of h) expect(['harbor', 'fortress', 'seal']).not.toContain(e);
  });

  it('по всем стратегиям достижимы все концовки из endings.json', () => {
    const all = [...runAll(gameData, STRATEGIES, 20).values()].flat();
    expect(coverage(gameData, all).endings).toEqual([]);
  });
});
