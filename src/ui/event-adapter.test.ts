import { describe, expect, it } from 'vitest';
import { createInitialState, gameData } from '../core';
import { applyChoice, choiceAvailability, eventText, previewChoice } from './event-adapter';

const state = () => createInitialState(gameData.balance, 'test');
const ev = (id: string) => {
  const e = gameData.events.find((x) => x.id === id);
  if (!e) throw new Error(id);
  return e;
};

describe('адаптер окна события', () => {
  it('подсказка d02_raft: стрелки по шагам ТЗ 6.7, фракция знаком, ⧗ за флаги', () => {
    const p = previewChoice(state(), gameData, 'd02_raft', 0);
    expect(p.memory).toBe(true);
    expect(p.hints).toContainEqual({ key: 'pop', kind: 'res', dir: 1, level: 1 });
    expect(p.hints).toContainEqual({ key: 'solidarity', kind: 'stat', dir: 1, level: 2 });
    expect(p.hints).toContainEqual({ key: 'mistborn', kind: 'faction', dir: 1, level: 1 });
  });

  it('закрытый вариант с lockedText виден, без lockedText скрыт, нехватка цены выключает', () => {
    const s = state();
    const dream = ev('d17_key_dream').choices[0];
    const rail = ev('pool_grey_at_rail').choices[2];
    const lab = ev('d04_lab').choices[0];
    if (!dream || !rail || !lab) throw new Error('нет вариантов');
    expect(choiceAvailability({ ...s, stats: { ...s.stats, trust: 10 } }, dream)).toMatchObject({
      visible: true,
      enabled: false,
      locked: true,
    });
    expect(choiceAvailability(s, rail).visible).toBe(false);
    expect(choiceAvailability({ ...s, res: { ...s.res, mat: 3 } }, lab)).toMatchObject({
      enabled: false,
      reason: 'Нужно 15 материалов',
    });
  });

  it('применение прибавляет эффекты, ставит флаги, планирует отложенное и пишет журнал', () => {
    const s = state();
    const { state: next, result } = applyChoice(s, gameData, 'd01_first_morning', 1);
    expect(next.stats.order).toBe(Math.min(100, s.stats.order + 8));
    expect(next.flags).toContain('lied_day1');
    expect(next.scheduled).toContainEqual({ day: s.day + 9, event: 'late_ledger' });
    expect(next.log.at(-1)?.text).toBe(result.log);
    expect(eventText(s, ev('d01_first_morning'))).toContain('Совет');
  });
});
