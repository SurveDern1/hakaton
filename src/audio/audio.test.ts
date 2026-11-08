import { describe, expect, it } from 'vitest';
import { build, createInitialState, demolish, gameData, startNewTier } from '../core';
import { FALL_MS } from '../scenes/tower-dom';
import { DEFAULT_SETTINGS, parseSettings } from './audio';
import { type Cue, SLOT_PAN, slotPan, stateCues } from './cues';
import { DROP } from './sfx';

describe('настройки звука', () => {
  it('битая или пустая запись — значения по умолчанию', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{oops')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('42')).toEqual(DEFAULT_SETTINGS);
  });
  it('громкость обрезается до 0..1, выключение сохраняется', () => {
    expect(parseSettings('{"muted":true,"music":3,"sfx":-1}')).toMatchObject({
      muted: true,
      music: 1,
      sfx: 0,
    });
  });
  it('старая запись без новых полей и чужая мелодия — значения по умолчанию', () => {
    const s = parseSettings('{"music":0.3,"melody":"polka"}');
    expect(s).toMatchObject({ master: 1, musicOn: true, sfxOn: true, melody: 'waltz', music: 0.3 });
    expect(parseSettings('{"melody":"march","musicOn":false}')).toMatchObject({
      melody: 'march',
      musicOn: false,
    });
  });
  it('старая запись без атмосферы — атмосфера включена на 0,7; громкость обрезается', () => {
    expect(parseSettings('{"music":0.3,"sfx":0.5}')).toMatchObject({ ambience: 0.7, ambienceOn: true });
    expect(parseSettings('{"ambience":2,"ambienceOn":false}')).toMatchObject({
      ambience: 1,
      ambienceOn: false,
    });
  });
});

describe('звуки по изменению состояния', () => {
  const data = gameData;
  const s0 = createInitialState(data.balance, 1);
  const names = (c: Cue[]) => c.map((x) => x.name);

  function firstBuild() {
    for (let t = 0; t < s0.tiers.length; t++) {
      const slots = s0.tiers[t]?.slots ?? [];
      for (let i = 0; i < slots.length; i++) {
        if (slots[i]) continue;
        for (const id of Object.keys(data.balance.buildings)) {
          const r = build(s0, data, t, i, id);
          if (r.ok) return { r, t, i };
        }
      }
    }
    throw new Error('Негде строить');
  }

  it('стройка и снос', () => {
    const { r, t, i } = firstBuild();
    if (!r.ok) throw new Error();
    expect(names(stateCues(s0, r.state))).toContain('build');
    const d = demolish(r.state, data, t, i);
    if (!d.ok) throw new Error(d.reason);
    expect(names(stateCues(r.state, d.state))).toContain('demolish');
  });

  it('закладка яруса', () => {
    const r = startNewTier({ ...s0, res: { ...s0.res, mat: 9999 } }, data);
    if (!r.ok) throw new Error(r.reason);
    expect(names(stateCues(s0, r.state))).toContain('tierStart');
  });

  it('ярус пропал или прибавился', () => {
    const fewer = { ...s0, tiers: s0.tiers.slice(1) };
    expect(stateCues(s0, fewer)).toEqual([{ name: 'tierDrop', tier: 0 }]);
    expect(names(stateCues(fewer, { ...s0, day: 2 }))).toEqual(['tierUp', 'calendar']);
  });

  it('новая партия молчит', () => {
    const late = { ...s0, day: 9 };
    expect(stateCues(late, s0)).toEqual([]);
  });

  it('сброс верхнего яруса — с его номером', () => {
    const top = s0.tiers.length - 1;
    expect(stateCues(s0, { ...s0, tiers: s0.tiers.slice(0, top) })).toEqual([
      { name: 'tierDrop', tier: top },
    ]);
  });

  it('смена дня — листок календаря, в последний день — красный', () => {
    const days = data.balance.calendar.days;
    expect(stateCues(s0, { ...s0, day: 2 }, days)).toEqual([{ name: 'calendar' }]);
    const eve = { ...s0, day: days - 1 };
    expect(stateCues(eve, { ...eve, day: days }, days)).toEqual([{ name: 'calendarRed' }]);
  });

  it('рычаг двигателя: вверх к набору высоты, вниз к экономии; ночью рычага нет', () => {
    const hold = { ...s0, engineMode: 'hold' as const };
    expect(stateCues(hold, { ...hold, engineMode: 'climb' })).toEqual([{ name: 'lever', dir: 1 }]);
    expect(stateCues(hold, { ...hold, engineMode: 'save' })).toEqual([{ name: 'lever', dir: -1 }]);
    expect(names(stateCues(hold, { ...hold, engineMode: 'save', day: 2 }))).not.toContain('lever');
  });

  it('стройка и снос — со стороны слота', () => {
    expect([0, 1, 2].map((i) => slotPan(i, 3))).toEqual([-SLOT_PAN, 0, SLOT_PAN]);
    expect(slotPan(0, 1)).toBe(0);
    const { r, i } = firstBuild();
    if (!r.ok) throw new Error();
    const n = r.state.tiers.find((t) => t.slots[i])?.slots.length ?? 3;
    expect(stateCues(s0, r.state).find((c) => c.name === 'build')?.pan).toBe(slotPan(i, n));
  });
});

describe('сброс яруса в такт картинке', () => {
  it('свист — до конца падения башни, удар — вскоре после него', () => {
    expect(DROP.fall * 1000).toBe(FALL_MS);
    expect(DROP.snap).toBeLessThan(DROP.whistle);
    expect(DROP.thud).toBeGreaterThan(DROP.fall);
    expect(DROP.thud - DROP.fall).toBeLessThanOrEqual(0.6);
    expect(DROP.relief).toBeGreaterThan(DROP.fall);
  });
});
