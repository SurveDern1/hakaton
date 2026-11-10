import { describe, expect, it } from 'vitest';
import { gameData as data } from './data';
import { forecastNight } from './night';
import { ROOM_MOODS, roomInfo, tapLine, visitBlocker, visitReply, visitRoom } from './rooms';
import { createInitialState } from './state';
import type { GameState, RoomMood } from './types';

const fresh = (): GameState => createInitialState(data.balance, 'rooms');

describe('roomInfo', () => {
  it('пустой слот — не комната', () => {
    expect(roomInfo(fresh(), data, 0, 2)).toBeNull();
    expect(roomInfo(fresh(), data, 9, 0)).toBeNull();
  });

  it('выработка комнат складывается в ту же выработку, что даёт ночь', () => {
    for (const s of [fresh(), { ...fresh(), res: { ...fresh().res, pop: 4 } }]) {
      const sum: Record<string, number> = {};
      for (const [i, t] of s.tiers.entries())
        for (const j of t.slots.keys())
          for (const [k, v] of Object.entries(roomInfo(s, data, i, j)?.output?.effects ?? {}))
            sum[k] = (sum[k] ?? 0) + v;
      expect(sum).toEqual(forecastNight(s, data).produced);
    }
  });

  it('мало рабочих: причина «рабочие» и настроение «мало рук» или «пусто»', () => {
    const s = fresh();
    s.res.pop = 4; // Уловитель в Корне забирает троих, ферме достаётся один
    const farm = roomInfo(s, data, 1, 2);
    expect(farm?.workers).toEqual({ have: 1, need: 3 });
    expect(farm?.output?.reasons[0]).toEqual({ kind: 'staff', factor: 1 / 3 });
    expect(farm?.moods).toContain('short');
    s.res.pop = 3;
    expect(roomInfo(s, data, 1, 2)?.moods).toContain('empty');
  });

  it('ярус в Мгле: настроение «Мгла» первым и половина выработки', () => {
    const s = fresh();
    s.mist = s.altitude + 16; // выше середины второго яруса (altitude + 15)
    const farm = roomInfo(s, data, 1, 2);
    expect(farm?.moods[0]).toBe('mist');
    expect(farm?.output?.reasons.some((r) => r.kind === 'mist')).toBe(true);
  });

  it('жилые модули заселяются после встроенных мест, слева направо', () => {
    const s = fresh();
    s.res.pop = 4 + 8; // Корень — 4 места, во втором ярусе 8 человек на два модуля по 6
    expect(roomInfo(s, data, 1, 0)?.residents).toEqual({ live: 6, places: 6 });
    expect(roomInfo(s, data, 1, 1)?.residents).toEqual({ live: 2, places: 6 });
  });

  it('настроения идут в порядке важности, у каждого есть подпись', () => {
    const s = fresh();
    s.stats.health = 5;
    s.stats.order = 5;
    s.res.food = 0;
    const moods = roomInfo(s, data, 1, 0)?.moods ?? [];
    expect(moods).toEqual(ROOM_MOODS.filter((m) => moods.includes(m)));
    expect(moods).toEqual(expect.arrayContaining(['hungry', 'sick', 'unrest']));
    for (const m of ROOM_MOODS) expect(data.rooms.moods[m]?.label).toBeTruthy();
  });

  it('реплика: по флагу — своя, и одна и та же в течение дня', () => {
    const s = fresh();
    const a = roomInfo(s, data, 0, 0)?.line;
    expect(a?.text).toBeTruthy();
    expect(roomInfo(s, data, 0, 0)?.line).toEqual(a);
    s.flags = ['marta_respect'];
    expect(roomInfo(s, data, 0, 0)?.line?.requires?.flags).toEqual(['marta_respect']);
  });

  it('у каждого здания есть реплика в любом настроении', () => {
    const s = fresh();
    for (const id of Object.keys(data.balance.buildings)) {
      s.tiers[1] = { ...s.tiers[1], kind: 'tier', slots: [id, null, null], mistNights: 0, abandoned: false };
      expect(roomInfo(s, data, 1, 0)?.line, id).toBeTruthy();
    }
  });
});

describe('обход', () => {
  it('раз в день: эффект сразу, второй раз нельзя, на следующий день снова можно', () => {
    const s = fresh();
    const r = visitRoom(s, data, 1, 2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.res.food).toBe(s.res.food + (data.balance.rooms.visit.farm?.food ?? 0));
    expect(r.state.visit).toEqual({ day: 1, tier: 1, slot: 2 });
    expect(r.state.log.at(-1)?.text).toContain('Гидропонная ферма');
    expect(roomInfo(r.state, data, 1, 2)?.visit.here).toBe(true);
    expect(visitBlocker(r.state, data, 0, 0)).toContain('Гидропонная ферма');
    expect(visitRoom(r.state, data, 0, 0).ok).toBe(false);
    expect(visitBlocker({ ...r.state, day: 2 }, data, 0, 0)).toBeNull();
    expect(s.visit).toBeUndefined();
  });

  it('пустой слот и заброшенный ярус — не зайти', () => {
    const s = fresh();
    expect(visitBlocker(s, data, 0, 2)).toBe('Здесь никого нет');
    s.tiers[1] = { ...s.tiers[1], kind: 'tier', slots: ['farm', null, null], mistNights: 3, abandoned: true };
    expect(visitBlocker(s, data, 1, 0)).toBe('Ярус заброшен');
  });

  it('у каждого строящегося здания есть эффект обхода и ответ', () => {
    for (const id of Object.keys(data.balance.buildings)) {
      expect(Object.keys(data.balance.rooms.visit[id] ?? {}).length, id).toBeGreaterThan(0);
      expect(visitReply(data, id)?.text, id).toBeTruthy();
    }
  });
});

describe('tapLine', () => {
  const acts = ['work', 'walk', 'sit', 'lie', 'talk'] as const;

  it('у каждой позы в каждом здании есть фраза, повторное нажатие даёт другую', () => {
    const s = fresh();
    for (const b of Object.keys(data.balance.buildings))
      for (const act of acts) {
        const a = tapLine(s, data, b, ['calm'], act, 0);
        const c = tapLine(s, data, b, ['calm'], act, 1);
        expect(a?.text, `${b} ${act}`).toBeTruthy();
        expect(c?.text, `${b} ${act}`).not.toBe(a?.text);
      }
  });

  it('сначала фразы своего здания, позы и настроения; чужие не попадают', () => {
    const s = fresh();
    const texts = (b: string, act: (typeof acts)[number], moods: RoomMood[]) =>
      [0, 1, 2, 3, 4, 5].map((n) => tapLine(s, data, b, moods, act, n)?.text);
    const own = data.rooms.tap.filter((t) => t.b === 'infirmary' && t.act === 'lie').map((t) => t.text);
    expect(texts('infirmary', 'lie', ['sick'])).toEqual(expect.arrayContaining(own));
    for (const t of texts('farm', 'sit', ['calm'])) {
      const line = data.rooms.tap.find((x) => x.text === t);
      expect(line?.b === undefined || line?.b === 'farm').toBe(true);
      expect(line?.act === undefined || line?.act === 'sit').toBe(true);
      expect(line?.mood).toBeUndefined();
    }
  });

  it('нажатие не меняет состояние', () => {
    const s = fresh();
    const before = JSON.stringify(s);
    tapLine(s, data, 'housing', ['calm'], 'lie', 3);
    expect(JSON.stringify(s)).toBe(before);
  });
});
