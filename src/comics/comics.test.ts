import { describe, expect, it } from 'vitest';
import { gameData } from '../core';
import { checkComics, comicsFile, getComic, outroFor, pageGrid } from './data';
import { ComicNav } from './nav';
import { PLACEHOLDER_SCENES } from './placeholder';

describe('data/comics.json', () => {
  it('сходится: сетки, кадры, пролог и эпилог для каждой концовки', () => {
    const endings = gameData.endings.endings.map((e) => e.id);
    expect(checkComics(comicsFile, endings)).toEqual([]);
  });

  it('у каждой заглушки есть сцена', () => {
    for (const c of comicsFile.comics)
      for (const p of c.pages)
        for (const panel of p.panels) if (panel.art) expect(PLACEHOLDER_SCENES).toContain(panel.art.scene);
  });

  it('эпилог по концовке, иначе общий', () => {
    expect(outroFor('harbor')?.id).toBe('outro_harbor');
    expect(outroFor('nope')?.id).toBe('outro');
    expect(getComic('intro')?.pages.length).toBeGreaterThan(0);
  });
});

describe('pageGrid', () => {
  const panels = (n: number) => Array.from({ length: n }, () => ({ art: { scene: 'tower' } }));

  it('раскладка буквами → grid-template-areas', () => {
    const g = pageGrid({ grid: 'ab/cb', rows: [2, 1], panels: panels(3) });
    expect(g.areas).toBe('"a b" "c b"');
    expect(g.columns).toBe(2);
    expect(g.rows).toBe('minmax(0, 2fr) minmax(0, 1fr)');
    expect(g.names).toEqual(['a', 'b', 'c']);
  });

  it('без grid — раскладка по числу кадров', () => {
    expect(pageGrid({ panels: panels(3) }).areas).toBe('"a a" "b c"');
  });

  it('ловит ошибки раскладки', () => {
    expect(() => pageGrid({ grid: 'ab/c', panels: panels(3) })).toThrow(/разной длины/);
    expect(() => pageGrid({ grid: 'a/b', panels: panels(3) })).toThrow(/кадров 3/);
    expect(() => pageGrid({ grid: 'ba', panels: panels(2) })).toThrow(/по порядку/);
    expect(() => pageGrid({ grid: 'ab/ba', panels: panels(2) })).toThrow(/не прямоугольная/);
  });

  it('checkComics находит битые страницы', () => {
    const bad = {
      version: 1,
      comics: [{ id: 'x', title: 'x', pages: [{ grid: 'a/b', panels: [{ image: '/a.png' }] }] }],
    };
    const errors = checkComics(bad, ['fall']);
    expect(errors.join('\n')).toMatch(/кадров 1/);
    expect(errors.join('\n')).toMatch(/ведущего/);
    expect(errors.join('\n')).toMatch(/нет пролога/);
    expect(errors.join('\n')).toMatch(/концовки fall/);
  });
});

describe('ComicNav', () => {
  it('сначала дорисовывает страницу, потом листает, в конце — end', () => {
    const nav = new ComicNav([2, 1]);
    expect(nav.revealOne()).toBe(true);
    expect(nav.next()).toBe('reveal');
    expect(nav.complete).toBe(true);
    expect(nav.next()).toBe('page');
    expect([nav.page, nav.shown]).toEqual([1, 0]);
    expect(nav.next()).toBe('reveal');
    expect(nav.next()).toBe('end');
  });

  it('назад открывает прошлую страницу целиком, с первой — никуда', () => {
    const nav = new ComicNav([3, 2]);
    expect(nav.back()).toBe('none');
    nav.turn(1);
    expect(nav.back()).toBe('page');
    expect([nav.page, nav.shown]).toEqual([0, 3]);
  });

  it('жест листает без дорисовки', () => {
    const nav = new ComicNav([3, 2]);
    expect(nav.turn(1)).toBe('page');
    expect(nav.isLast).toBe(true);
    expect(nav.turn(1)).toBe('end');
  });
});
