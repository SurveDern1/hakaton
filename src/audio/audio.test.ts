import { describe, expect, it } from 'vitest';
import { build, createInitialState, demolish, gameData, startNewTier } from '../core';
import { DEFAULT_SETTINGS, parseSettings } from './audio';
import { stateCues } from './cues';

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
});

describe('звуки по изменению состояния', () => {
  const data = gameData;
  const s0 = createInitialState(data.balance, 1);

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
    expect(stateCues(s0, r.state)).toContain('build');
    const d = demolish(r.state, data, t, i);
    if (!d.ok) throw new Error(d.reason);
    expect(stateCues(r.state, d.state)).toContain('demolish');
  });

  it('закладка яруса', () => {
    const r = startNewTier({ ...s0, res: { ...s0.res, mat: 9999 } }, data);
    if (!r.ok) throw new Error(r.reason);
    expect(stateCues(s0, r.state)).toContain('tierStart');
  });

  it('ярус пропал или прибавился', () => {
    const fewer = { ...s0, tiers: s0.tiers.slice(1) };
    expect(stateCues(s0, fewer)).toEqual(['tierDrop']);
    expect(stateCues(fewer, { ...s0, day: 2 })).toEqual(['tierUp']);
  });

  it('новая партия молчит', () => {
    const late = { ...s0, day: 9 };
    expect(stateCues(late, s0)).toEqual([]);
  });
});
