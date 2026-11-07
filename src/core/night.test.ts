import { describe, expect, it } from 'vitest';
import { type ActionResult, build, demolish, dropTier, startNewTier, toggleDecree } from './actions';
import { gameData } from './data';
import { forecastNight, forecastWarnings, runNight } from './night';
import { createInitialState } from './state';
import { etherNeed } from './tower';
import type { GameState } from './types';

const data = gameData;
const fresh = () => createInitialState(data.balance, 'night');
const ok = (r: ActionResult): GameState => {
  if (!r.ok) throw new Error(r.reason);
  return r.state;
};

describe('ночь со старта (ТЗ 4.7)', () => {
  const { state, report } = runNight(fresh(), data);

  it('еда +7 −10, эфир +10 −11', () => {
    expect(report.produced).toMatchObject({ food: 7, ether: 10 });
    expect(report.foodEaten).toBe(10);
    expect(report.etherNeed).toBe(11);
    expect(state.res.food).toBe(37);
    expect(state.res.ether).toBe(29);
  });

  it('Мгла +3,1 м, высота держится, дрейф −1, день +1', () => {
    expect(report.mistRise).toBe(3.1);
    expect(state.mist).toBe(23.1);
    expect(state.altitude).toBe(60);
    expect(state.stats.solidarity).toBe(59);
    expect(state.stats.order).toBe(59);
    expect(state.day).toBe(2);
    expect(report.defeat).toBeNull();
  });

  it('исходное состояние не меняется, прогноз совпадает с результатом', () => {
    const s = fresh();
    const copy = structuredClone(s);
    expect(forecastNight(s, data)).toEqual(runNight(s, data).report);
    expect(s).toEqual(copy);
  });
});

describe('двигатель', () => {
  it('набор высоты: сжечь need × 1,5 вверх, +10 м', () => {
    const { state, report } = runNight({ ...fresh(), engineMode: 'climb' }, data);
    expect(report.etherBurned).toBe(17);
    expect(state.altitude).toBe(70);
  });

  it('экономия: половина эфира, −10 м', () => {
    const { state, report } = runNight({ ...fresh(), engineMode: 'save' }, data);
    expect(report.etherBurned).toBe(6);
    expect(state.altitude).toBe(50);
  });

  it('нехватка: сжигается всё, высота падает на ⌈20 × долю⌉', () => {
    const s = fresh();
    s.res.ether = 0;
    s.tiers[0]?.slots.splice(1, 1, null);
    const { state, report } = runNight(s, data);
    expect(report.etherBurned).toBe(0);
    expect(report.shortfallAltitudeLoss).toBe(20);
    expect(state.altitude).toBe(40);
    expect(forecastWarnings(report)[0]).toContain('просядет на 20 м');
  });

  it('Корень в Мгле: need +25 %', () => {
    const s = fresh();
    s.mist = 70;
    expect(etherNeed(s, data.balance)).toBe(Math.ceil(11 * 1.25));
  });
});

describe('Мгла и ярусы', () => {
  it('обычный ярус в Мгле 3 ночи подряд забрасывается, жители становятся бездомными', () => {
    let s = fresh();
    s.mist = 74; // Корень уже в Мгле, середина яруса 1 (75 м) уйдёт под Мглу этой ночью
    const reports = [];
    for (let i = 0; i < 3; i++) {
      const r = runNight(s, data);
      reports.push(r.report);
      s = r.state;
    }
    expect(reports[0]?.newlySubmerged).toEqual([1]);
    expect(forecastWarnings(reports[0] ?? forecastNight(s, data))).toContain('Ярус уйдёт в Мглу');
    expect(reports[2]?.abandoned).toEqual([1]);
    expect(s.tiers[1]?.abandoned).toBe(true);
    expect(s.tiers[0]?.abandoned).toBe(false);
    expect(runNight(s, data).report.homeless).toBe(Math.max(0, s.res.pop - 8));
  });

  it('здания в Мгле дают половину', () => {
    const s = fresh();
    s.mist = 66;
    expect(runNight(s, data).report.produced.ether).toBe(5);
  });

  it('«Падение»: Мгла выше середины Шпиля', () => {
    const s = fresh();
    s.mist = 84;
    const { state, report } = runNight(s, data);
    expect(report.defeat).toBe('fall');
    expect(state.ending).toBe('fall');
  });

  it('«Свержение»: доверие до нуля', () => {
    const s = fresh();
    s.stats.trust = 0;
    expect(runNight(s, data).report.defeat).toBe('overthrow');
  });
});

describe('пороги и жители', () => {
  it('голод: еда 0, здоровье −5, доверие −3', () => {
    const s = fresh();
    s.res.food = 0;
    s.tiers[1]?.slots.splice(2, 1, null);
    const { state, report } = runNight(s, data);
    expect(report.foodShortage).toBe(true);
    expect(state.res.food).toBe(0);
    expect(state.stats.trust).toBe(57);
  });

  it('здоровье < 30: умирают 5 % вверх', () => {
    const s = fresh();
    s.stats.health = 20;
    expect(runNight(s, data).report.deaths).toBe(1);
  });

  it('бездомные бьют по здоровью, не больше −10', () => {
    const s = fresh();
    s.res.pop = 60;
    const { report } = runNight(s, data);
    expect(report.homeless).toBe(40);
    expect(report.delta.stats.health).toBe(-10);
  });

  it('нехватка рабочих: здание работает пропорционально', () => {
    const s = fresh();
    s.res.pop = 4;
    const { report } = runNight(s, data);
    expect(report.understaffed).toEqual(['1:2']);
    expect(report.produced.food).toBe(2);
  });
});

describe('модификаторы и декреты', () => {
  it('отсрочка, действие и снятие модификатора', () => {
    let s = fresh();
    s.modifiers = [{ id: 'm', nights: 2, left: 2, startInNights: 1, perNight: { mat: -5 } }];
    const r1 = runNight(s, data);
    expect(r1.state.res.mat).toBe(45);
    s = runNight(r1.state, data).state;
    const r3 = runNight(s, data);
    expect(r3.report.expiredModifiers).toEqual(['m']);
    expect(r3.state.res.mat).toBe(35);
    expect(r3.state.modifiers).toEqual([]);
  });

  it('двойные смены: уловитель +30 %, выключенный декрет ждёт 2 дня', () => {
    const on = ok(toggleDecree(fresh(), data, 'double_shifts'));
    expect(runNight(on, data).report.produced.ether).toBe(13);
    const off = ok(toggleDecree(on, data, 'double_shifts'));
    expect(toggleDecree(off, data, 'double_shifts').ok).toBe(false);
    expect(toggleDecree({ ...off, day: 3 }, data, 'double_shifts').ok).toBe(true);
    expect(toggleDecree(fresh(), data, 'quarantine').ok).toBe(false);
  });
});

describe('стройка', () => {
  it('ферма, ограничения уловителя, снос с возвратом половины', () => {
    let s = ok(build(fresh(), data, 0, 2, 'farm'));
    expect(s.res.mat).toBe(30);
    expect(build(s, data, 2, 1, 'catcher').ok).toBe(false);
    expect(build(s, data, 2, 1, 'red_corner').ok).toBe(false);
    s = ok(demolish(s, data, 0, 2));
    expect(s.res.mat).toBe(37);
    expect(demolish(s, data, 0, 0).ok).toBe(false);
  });

  it('новый ярус: 25 материалов, встаёт под Шпилем через 2 ночи', () => {
    let s = ok(startNewTier(fresh(), data));
    expect(s.res.mat).toBe(20);
    expect(startNewTier(s, data).ok).toBe(false);
    s = runNight(s, data).state;
    expect(s.tiers).toHaveLength(3);
    const r = runNight(s, data);
    expect(r.report.tierBuilt).toBe(true);
    expect(r.state.tiers.map((t) => t.kind)).toEqual(['root', 'tier', 'tier', 'spire']);
  });

  it('сброс яруса: гибнут его жители, солидарность −15, шрам', () => {
    const s = ok(dropTier(fresh(), data, 1));
    expect(s.tiers).toHaveLength(2);
    expect(s.res.pop).toBe(8);
    expect(s.stats.solidarity).toBe(45);
    expect(s.scars).toContain('tier_stump');
    expect(dropTier(fresh(), data, 0).ok).toBe(false);
  });
});

describe('баланс без решений (ТЗ 4.4)', () => {
  it('Мгла накрывает Корень к середине игры, башня доживает минимум до дня 12', () => {
    let s = fresh();
    let rootDay = 0;
    for (let i = 0; i < 25 && !s.ending; i++) {
      const r = runNight(s, data);
      s = r.state;
      if (!rootDay && r.report.tiersInMist.includes(0)) rootDay = s.day;
    }
    expect(rootDay).toBeGreaterThan(8);
    expect(s.day).toBeGreaterThan(12);
  });
});
