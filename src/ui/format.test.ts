import { describe, expect, it } from 'vitest';
import { splitPunct } from './format';

describe('splitPunct', () => {
  it('отделяет знаки после слова', () => {
    expect(splitPunct('Ия, 10 лет')).toEqual([
      { text: 'Ия', punct: false },
      { text: ',', punct: true },
      { text: ' 10 лет', punct: false },
    ]);
    expect(
      splitPunct('Всем! Всем!')
        .filter((p) => p.punct)
        .map((p) => p.text),
    ).toEqual(['!', '!']);
  });

  it('не трогает текст без знаков и знак после пробела', () => {
    expect(splitPunct('Плот из Мглы')).toEqual([{ text: 'Плот из Мглы', punct: false }]);
    expect(splitPunct('Итог — 5')).toEqual([{ text: 'Итог — 5', punct: false }]);
  });
});
