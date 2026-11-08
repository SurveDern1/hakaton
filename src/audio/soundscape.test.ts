import { describe, expect, it } from 'vitest';
import { createInitialState, gameData } from '../core';
import { saturation } from './ambience';
import {
  type AmbUi,
  endingVerdict,
  MIST_NIGHT,
  mistNearness,
  NO_UI,
  type SoundInput,
  soundInputFromState,
  soundscape,
} from './soundscape';

const DAY: SoundInput = {
  mode: 'hold',
  ether: 0.7,
  mistGap: 40,
  tierHeight: 10,
  heightFrac: 0.2,
  tiersInMist: 0,
  scars: 0,
};
const at = (p: Partial<SoundInput>) => ({ ...DAY, ...p });

describe('soundscape: двигатель', () => {
  it('набор высоты — выше, ярче и плотнее, экономия — ниже, глуше и тише', () => {
    const save = soundscape(at({ mode: 'save' }), 'day').engine;
    const hold = soundscape(at({ mode: 'hold' }), 'day').engine;
    const climb = soundscape(at({ mode: 'climb' }), 'day').engine;
    expect(save.f0).toBeLessThan(hold.f0);
    expect(hold.f0).toBeLessThan(climb.f0);
    expect(save.cutoff).toBeLessThan(hold.cutoff);
    expect(hold.cutoff).toBeLessThan(climb.cutoff);
    expect(save.gain).toBeLessThan(hold.gain);
    expect(climb.pulseHz).toBeGreaterThan(hold.pulseHz);
    expect(climb.turbine).toBeGreaterThan(hold.turbine);
    expect(save.turbine).toBe(0);
  });

  it('эфир ниже 0,5 включает перебои, тем сильнее, чем меньше эфира', () => {
    expect(soundscape(at({ ether: 0.5 }), 'day').engine.stutter).toBe(0);
    expect(soundscape(at({ ether: 0.9 }), 'day').engine.stutter).toBe(0);
    const some = soundscape(at({ ether: 0.4 }), 'day').engine.stutter;
    const lots = soundscape(at({ ether: 0.1 }), 'day').engine.stutter;
    expect(some).toBeGreaterThan(0);
    expect(lots).toBeGreaterThan(some);
  });

  it('на старте и в финале двигателя и Мглы нет, ветер есть', () => {
    for (const phase of ['start', 'final'] as const) {
      const t = soundscape(at({ mistGap: 0 }), phase);
      expect(t.engine.gain).toBe(0);
      expect(t.mist.gain).toBe(0);
      expect(t.creakEvery).toBe(Number.POSITIVE_INFINITY);
      expect(t.wind.gain).toBeGreaterThan(0);
    }
    expect(soundscape(DAY, 'final').fade).toBeGreaterThanOrEqual(1);
  });
});

describe('soundscape: Мгла', () => {
  it('дальше двух ярусов молчит, ближе — громче и ярче', () => {
    expect(soundscape(at({ mistGap: 20 }), 'day').mist.gain).toBe(0);
    expect(soundscape(at({ mistGap: 35 }), 'night').mist.gain).toBe(0);
    const mid = soundscape(at({ mistGap: 12 }), 'day').mist;
    const close = soundscape(at({ mistGap: 3 }), 'day').mist;
    expect(mid.gain).toBeGreaterThan(0);
    expect(close.gain).toBeGreaterThan(mid.gain);
    expect(close.open).toBeGreaterThan(mid.open);
  });

  it('ярус в Мгле — слышна постоянно, как вплотную', () => {
    expect(mistNearness(at({ mistGap: 30, tiersInMist: 1 }))).toBe(1);
    expect(mistNearness(at({ mistGap: -3 }))).toBe(1);
  });

  it('ночью громче в полтора раза и шепчет', () => {
    const day = soundscape(at({ mistGap: 12 }), 'day').mist;
    const night = soundscape(at({ mistGap: 12 }), 'night').mist;
    expect(night.gain).toBeCloseTo(day.gain * MIST_NIGHT, 6);
    expect(night.whisper).toBeGreaterThan(day.whisper);
  });
});

describe('soundscape: ветер, скрипы, приглушение', () => {
  it('ветер крепче на высоте и ночью', () => {
    const low = soundscape(at({ heightFrac: 0 }), 'day').wind;
    const high = soundscape(at({ heightFrac: 1 }), 'day').wind;
    const night = soundscape(at({ heightFrac: 0 }), 'night').wind;
    expect(high.gain).toBeGreaterThan(low.gain);
    expect(night.gain).toBeGreaterThan(low.gain);
    expect(night.gust).toBeGreaterThan(low.gust);
  });

  it('скрипы чаще при крене, шрамах и ярусе в Мгле', () => {
    const calm = soundscape(DAY, 'day').creakEvery;
    expect(soundscape(at({ ether: 0.1 }), 'day').creakEvery).toBeLessThan(calm);
    expect(soundscape(at({ scars: 2 }), 'day').creakEvery).toBeLessThan(calm);
    expect(soundscape(at({ tiersInMist: 1 }), 'day').creakEvery).toBeLessThan(calm);
  });

  it('окно события приглушает фон, комикс и итог — сильнее, без окон — нет', () => {
    const ui = (p: Partial<AmbUi>) => ({ ...NO_UI, ...p });
    expect(soundscape(DAY, 'day').duckDb).toBe(0);
    const ev = soundscape(DAY, 'morning', ui({ event: true })).duckDb;
    expect(ev).toBeLessThan(0);
    expect(soundscape(DAY, 'day', ui({ paper: true })).duckDb).toBeLessThan(0);
    expect(soundscape(DAY, 'start', ui({ comic: true })).duckDb).toBeLessThan(ev);
  });
});

describe('soundInputFromState', () => {
  it('старт игры: держать высоту, Мгла на 4 яруса ниже — не слышна', () => {
    const s = createInitialState(gameData.balance, 1);
    const input = soundInputFromState(s, gameData.balance);
    expect(input.mode).toBe(s.engineMode);
    expect(input.mistGap).toBe(s.altitude - s.mist);
    expect(input.heightFrac).toBe(0);
    expect(input.tiersInMist).toBe(0);
    expect(input.ether).toBeGreaterThan(0);
    expect(soundscape(input, 'day').mist.gain).toBe(0);
  });

  it('Мгла поднялась над Корнем — ярус в Мгле', () => {
    const s = createInitialState(gameData.balance, 1);
    s.mist = s.altitude + 6;
    expect(soundInputFromState(s, gameData.balance).tiersInMist).toBeGreaterThan(0);
  });
});

describe('saturation', () => {
  it('нечётная, монотонная, в пределах ±1', () => {
    const c = saturation(2.6, 101);
    expect(c[0]).toBeCloseTo(-1, 6);
    expect(c[100]).toBeCloseTo(1, 6);
    expect(c[50]).toBeCloseTo(0, 6);
    for (let i = 1; i < c.length; i++) expect(c[i] as number).toBeGreaterThan(c[i - 1] as number);
  });
});

describe('soundscape: события сцены', () => {
  it('подъём Мглы ночью — шорох громче и ярче даже вдали, днём подъёма нет', () => {
    const far = at({ mistGap: 60 });
    const night = soundscape(far, 'night').mist;
    const rise = soundscape(far, 'night', NO_UI, { rising: true }).mist;
    expect(night.gain).toBe(0);
    expect(rise.gain).toBeGreaterThan(0.3);
    expect(rise.open).toBeGreaterThan(night.open);
    expect(rise.whisper).toBeGreaterThan(0);
    const near = at({ mistGap: 3 });
    expect(soundscape(near, 'night', NO_UI, { rising: true }).mist.gain).toBeGreaterThan(
      soundscape(near, 'night').mist.gain,
    );
    expect(soundscape(far, 'day', NO_UI, { rising: true }).mist).toEqual(soundscape(far, 'day').mist);
  });

  it('финал: двигатель и Мгла молчат, ветер остаётся; погибли — тише и глуше, выжили — мягче', () => {
    const win = soundscape(DAY, 'final', NO_UI, { verdict: 'win' });
    const lose = soundscape(DAY, 'final', NO_UI, { verdict: 'lose' });
    const plain = soundscape(DAY, 'final');
    for (const t of [win, lose, plain]) {
      expect(t.engine.gain).toBe(0);
      expect(t.mist.gain).toBe(0);
      expect(t.wind.gain).toBeGreaterThan(0);
      expect(t.fade).toBeGreaterThanOrEqual(1);
    }
    expect(lose.wind.gain).toBeLessThan(win.wind.gain);
    expect(lose.wind.center).toBeLessThan(win.wind.center);
    expect(win.wind.gust).toBeLessThan(plain.wind.gust);
  });

  it('итог концовки берётся из endings.json', () => {
    const s = createInitialState(gameData.balance, 1);
    const v = endingVerdict({ ...s, day: gameData.balance.calendar.days, ending: 'hold' }, gameData);
    expect(['win', 'lose']).toContain(v);
  });
});
