import { describe, expect, it } from 'vitest';
import { gameData as data } from './data';
import { chairReference, characterFates, earnedAwards } from './endings';
import { createInitialState } from './state';

describe('характеристика на Председателя', () => {
  it('по строке из группы, концовка выбирает приговор', () => {
    const s = createInitialState(data.balance);
    const lines = chairReference(s, data, 'fall');
    expect(lines).toContain('Делу Октября предан, к товарищам внимателен.');
    expect(lines).toContain('Морально устойчив.');
    expect(lines).toContain('В связях с Мглой не замечен.');
    expect(lines.at(-1)).toBe('Строгий выговор с занесением. Посмертно.');
  });

  it('флаги меняют строки, из группы берётся только первая подходящая', () => {
    const s = {
      ...createInitialState(data.balance),
      flags: ['lied_day1', 'told_truth', 'cat_on_duty', 'dog_kept'],
    };
    const lines = chairReference(s, data, 'harbor');
    expect(lines).toContain('Склонен приукрашивать сводки.');
    expect(lines).not.toContain('Говорит правду, даже когда её мало.');
    expect(lines).toContain('Кадровые вопросы решает смело: принял на склад кота.');
    expect(lines).not.toContain('Поставил на довольствие собаку Звёздочку.');
    expect(lines.at(-1)).toBe('Рекомендуется для работы в Гавани.');
  });

  it('у каждой концовки есть строка-приговор', () => {
    const s = createInitialState(data.balance);
    const last = data.endings.reference.at(-1) ?? [];
    for (const e of data.endings.endings) {
      expect(
        last.some((l) => l.endings?.includes(e.id)),
        e.id,
      ).toBe(true);
      expect(chairReference(s, data, e.id).length).toBeGreaterThan(3);
    }
  });
});

describe('значки и Звёздочка', () => {
  it('значки выдаются по условиям', () => {
    const s = { ...createInitialState(data.balance), flags: ['took_raft', 'iya_pioneer'] };
    const ids = earnedAwards(s, data).map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['raft', 'pioneer', 'quality']));
    expect(ids).not.toContain('subbotnik');
  });

  it('судьба Звёздочки только если собака встречалась', () => {
    const s = createInitialState(data.balance);
    expect(characterFates(s, data).some((f) => f.who === 'zvezdochka')).toBe(false);
    const kept = characterFates({ ...s, flags: ['dog_kept'] }, data).find((f) => f.who === 'zvezdochka');
    expect(kept?.text).toMatch(/Корень/);
  });
});
