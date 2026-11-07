import { describe, expect, it } from 'vitest';
import { gameData } from './data';
import { checkRequires } from './requires';
import { nextRandom, pickWeighted } from './rng';
import { countBuildings, createInitialState } from './state';

const fresh = () => createInitialState(gameData.balance, 'test');

describe('стартовое состояние', () => {
  it('берётся из balance.start и не делит с ним объекты', () => {
    const s = fresh();
    expect(s.day).toBe(1);
    expect(s.res).toEqual(gameData.balance.start.res);
    s.tiers[0]?.slots.splice(0, 1, null);
    expect(gameData.balance.start.tiers[0]?.slots[0]).toBe('core');
  });

  it('переживает сохранение в JSON', () => {
    const s = fresh();
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it('считает здания по ярусам', () => {
    expect(countBuildings(fresh(), 'housing')).toBe(2);
  });
});

describe('условия requires', () => {
  it('флаги, день, диапазоны и any', () => {
    const s = fresh();
    s.flags = ['told_truth'];
    s.day = 6;
    expect(checkRequires({ flags: ['told_truth'], minDay: 5 }, s)).toBe(true);
    expect(checkRequires({ notFlags: ['told_truth'] }, s)).toBe(false);
    expect(checkRequires({ anyFlags: ['x', 'told_truth'] }, s)).toBe(true);
    expect(checkRequires({ stats: { trust: { min: 61 } } }, s)).toBe(false);
    expect(checkRequires({ factions: { mistborn: { max: -10 } } }, s)).toBe(true);
    expect(checkRequires({ buildings: { farm: 2 } }, s)).toBe(false);
    expect(checkRequires({ any: [{ flags: ['x'] }, { maxDay: 6 }] }, s)).toBe(true);
  });
});

describe('генератор', () => {
  it('детерминирован и в [0, 1)', () => {
    const [a, s1] = nextRandom(42);
    const [b] = nextRandom(42);
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
    expect(nextRandom(s1)[0]).not.toBe(a);
  });

  it('pickWeighted не выбирает вес 0', () => {
    let seed = 1;
    for (let i = 0; i < 200; i++) {
      const [idx, next] = pickWeighted(seed, [0, 1, 0]);
      expect(idx).toBe(1);
      seed = next;
    }
  });
});

describe('данные', () => {
  it('у каждого сюжетного дня 1–20 есть событие', () => {
    const days = new Set(gameData.events.map((e) => e.day).filter(Boolean));
    for (let d = 1; d <= gameData.balance.calendar.days; d++) expect(days.has(d)).toBe(true);
  });
});
