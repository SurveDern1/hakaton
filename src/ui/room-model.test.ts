import { describe, expect, it } from 'vitest';
import { createInitialState, gameData as data, roomInfo } from '../core';
import { buildRoom, type Limb, ROOM_H, ROOM_W, type RoomInput, roomInputFromInfo } from './room-model';

const base: RoomInput = {
  b: 'farm',
  stage: 1,
  people: 3,
  moods: ['calm'],
  ether: 1,
  health: 60,
  solidarity: 60,
  visited: false,
  seed: 1,
};
const men = (parts: { c: string }[]) =>
  parts.filter((p) => p.c.split(' ').includes('rm-man') && !p.c.includes('rm-chair'));

describe('buildRoom', () => {
  it('у каждого здания из данных есть комната; рабочих столько, сколько работает', () => {
    for (const b of Object.keys(data.balance.buildings)) {
      const m = buildRoom({ ...base, b, people: 2 });
      expect(m.parts.length, b).toBeGreaterThan(5);
      expect(m.figures, b).toBe(men(m.parts).length);
    }
    for (const b of ['farm', 'catcher', 'salvage', 'guard'])
      for (const people of [0, 1, 2, 3])
        expect(men(buildRoom({ ...base, b, people }).parts).length, b).toBe(people);
  });

  it('ключи деталей уникальны, детали в пределах сцены по высоте', () => {
    const m = buildRoom({ ...base, b: 'housing', people: 6, moods: ['mist', 'dark', 'hungry', 'festive'] });
    const keys = m.parts.map((p) => p.k);
    expect(new Set(keys).size).toBe(keys.length);
    // Мгла нарочно шире комнаты: её обрезает край сцены
    for (const p of m.parts.filter((x) => !x.c.startsWith('rm-mist'))) {
      expect(p.y, p.k).toBeGreaterThanOrEqual(-1);
      expect(p.y + p.h, p.k).toBeLessThanOrEqual(ROOM_H + 1);
      expect(p.x + p.w, p.k).toBeGreaterThan(-100);
      expect(p.x, p.k).toBeLessThan(ROOM_W + 100);
    }
  });

  it('настроения видны в комнате', () => {
    const cls = (moods: RoomInput['moods']) =>
      buildRoom({ ...base, b: 'housing', moods })
        .parts.map((p) => p.c)
        .join(' ');
    expect(cls(['mist'])).toContain('rm-mist');
    expect(cls(['mist'])).toContain('rm-view mist');
    expect(cls(['dark'])).toContain('flicker');
    expect(cls(['hungry'])).toContain('rm-bowl empty');
    expect(cls(['festive'])).toContain('garland');
    expect(cls(['calm'])).not.toMatch(/rm-mist|flicker|garland/);
  });

  it('Председатель в комнате после обхода', () => {
    expect(buildRoom({ ...base, visited: true }).parts.some((p) => p.c.includes('rm-chair'))).toBe(true);
    expect(buildRoom(base).parts.some((p) => p.c.includes('rm-chair'))).toBe(false);
  });

  it('вход из состояния: на старте в жилом модуле живут, на ферме работают', () => {
    const s = createInitialState(data.balance, 'room');
    const home = roomInfo(s, data, 1, 0);
    const farm = roomInfo(s, data, 1, 2);
    if (!home || !farm) throw new Error('нет комнат');
    expect(roomInputFromInfo(home, s, 1).people).toBe(home.residents?.live);
    expect(roomInputFromInfo(farm, s, 1).people).toBe(farm.workers?.have);
  });
  it('житель — фигура из частей тела, у каждой позы свои части', () => {
    const flat = (ls: Limb[]): Limb[] => ls.flatMap((l) => [l, ...flat(l.kids ?? [])]);
    const need: Record<string, string[]> = {
      work: ['rm-head', 'rm-torso', 'rm-arm', 'rm-fore', 'rm-leg', 'rm-shin'],
      walk: ['rm-head', 'rm-torso', 'rm-arm', 'rm-leg', 'rm-shin'],
      talk: ['rm-head', 'rm-torso', 'rm-arm', 'rm-fore'],
      sit: ['rm-head', 'rm-torso', 'rm-stool', 'rm-leg', 'rm-shin', 'rm-foot', 'rm-arm'],
      lie: ['rm-head', 'rm-pillow', 'rm-blanket', 'rm-z'],
    };
    const seen = new Set<string>();
    for (const b of Object.keys(data.balance.buildings))
      for (const people of [1, 3, 6])
        for (const moods of [['calm'], ['sick', 'festive']] as RoomInput['moods'][]) {
          const m = buildRoom({ ...base, b, people, moods, health: 30 });
          const figs = m.parts.filter((p) => p.fig?.tap);
          expect(figs.length, b).toBe(m.figures);
          expect(new Set(figs.map((p) => p.fig?.i)).size, b).toBe(figs.length);
          for (const p of figs) {
            const f = p.fig;
            if (!f) continue;
            seen.add(f.act);
            expect(p.c.split(' '), p.k).toContain(f.act);
            expect(f.label, p.k).toMatch(/^[А-ЯЁ].+, [а-яё]+$/);
            const cls = flat(f.body).map((l) => l.c.split(' ')[0]);
            for (const c of need[f.act] ?? []) expect(cls, `${b} ${f.act}`).toContain(c);
          }
        }
    expect([...seen].sort()).toEqual(['lie', 'sit', 'talk', 'walk', 'work']);
  });

  it('Председатель — фигура, но не кнопка; число жителей без него', () => {
    const m = buildRoom({ ...base, visited: true });
    const chair = m.parts.find((p) => p.c.includes('rm-chair'));
    expect(chair?.fig?.tap).toBe(false);
    expect(chair?.fig?.body.length).toBeGreaterThan(4);
    expect(m.parts.filter((p) => p.fig?.tap).length).toBe(base.people);
  });

  it('одна комната всегда выглядит одинаково, фаза движения — от номера', () => {
    const a = buildRoom({ ...base, b: 'housing', people: 6 });
    expect(buildRoom({ ...base, b: 'housing', people: 6 })).toEqual(a);
    const delays = a.parts.filter((p) => p.fig).map((p) => /--dl:([^;]+)/.exec(p.s)?.[1]);
    expect(new Set(delays).size).toBeGreaterThan(1);
  });
});
