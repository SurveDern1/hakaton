import { describe, expect, it } from 'vitest';
import { morseBeeps, RADIO, radioScript } from './radio';

describe('морзянка «ВСЕМ»', () => {
  it('·−− ··· · −−: 9 сигналов, тире втрое длиннее точки', () => {
    const u = 0.1;
    const { beeps, length } = morseBeeps('ВСЕМ', u);
    const lens = beeps.map(([, d]) => Math.round(d / u));
    expect(lens).toEqual([1, 3, 3, 1, 1, 1, 1, 3, 3]);
    // В(9) + 3 + С(5) + 3 + Е(1) + 3 + М(7) = 31 единица
    expect(length).toBeCloseTo(31 * u, 6);
  });

  it('сигналы не перекрываются, между буквами пауза в три единицы', () => {
    const u = 0.1;
    const { beeps } = morseBeeps('ВСЕМ', u);
    for (let i = 1; i < beeps.length; i++) {
      const [s0, d0] = beeps[i - 1] as [number, number];
      const [s1] = beeps[i] as [number, number];
      expect(s1 - (s0 + d0)).toBeGreaterThanOrEqual(u - 1e-9);
    }
    // после В (третий сигнал) — пауза между буквами
    const [s2, d2] = beeps[2] as [number, number];
    expect((beeps[3] as [number, number])[0] - (s2 + d2)).toBeCloseTo(3 * u, 6);
  });
});

describe('расписание фразы', () => {
  it('три слова после настройки, надпись мигает в начале каждого', () => {
    const s = radioScript();
    expect(s.words).toHaveLength(RADIO.repeats);
    expect(s.words[0]).toBeCloseTo(RADIO.tune, 6);
    expect(s.beeps[0]?.[0]).toBeCloseTo(RADIO.tune, 6);
    // каждое слово начинается со своего сигнала
    for (const w of s.words) expect(s.beeps.some(([b]) => Math.abs(b - w) < 1e-9)).toBe(true);
    expect(s.length).toBeCloseTo(s.voiceEnd + RADIO.tail, 6);
  });

  it('фраза укладывается в период повтора окна «Сигнал» (8 с)', () => {
    expect(radioScript().length).toBeLessThan(8);
  });

  it('голос из файла: слова по отметкам манифеста, после настройки', () => {
    const s = radioScript({ length: 2.4, words: [0.1, 0.9, 1.7] });
    expect(s.beeps).toEqual([]);
    expect(s.words.map((w) => +(w - RADIO.tune).toFixed(3))).toEqual([0.1, 0.9, 1.7]);
    expect(s.voiceEnd).toBeCloseTo(RADIO.tune + 2.4, 6);
  });
});
