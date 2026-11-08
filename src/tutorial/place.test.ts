import { describe, expect, it } from 'vitest';
import { EDGE, GAP, overlap, placeCard, type Rect } from './place';

// Рамка телефона 390×844 и колонки 1440×900 (ширина 506).
const PHONE: Rect = { x: 0, y: 0, w: 390, h: 844 };
const COLUMN: Rect = { x: 467, y: 0, w: 506, h: 900 };
const CARD = { w: 340, h: 170 };

const inside = (p: { x: number; y: number }, w: number, h: number, f: Rect) =>
  p.x >= f.x + EDGE - 0.01 &&
  p.y >= f.y + EDGE - 0.01 &&
  p.x + w <= f.x + f.w - EDGE + 0.01 &&
  p.y + h <= f.y + f.h - EDGE + 0.01;

describe('placeCard', () => {
  it('без цели — по центру рамки, без стрелки', () => {
    const p = placeCard(null, CARD, PHONE);
    expect(p.side).toBe('center');
    expect(p.arrowX).toBeNull();
    expect(p.x).toBe(25);
    expect(p.y).toBe((844 - 170) / 2);
  });

  it('цель у верхнего края (шапка) — карточка под ней, стрелка над целью', () => {
    const food: Rect = { x: 140, y: 8, w: 70, h: 46 };
    const p = placeCard(food, CARD, PHONE);
    expect(p.side).toBe('below');
    expect(p.y).toBe(8 + 46 + GAP);
    expect(inside(p, 340, 170, PHONE)).toBe(true);
    // стрелка указывает на центр цели
    expect(p.x + (p.arrowX ?? 0)).toBeCloseTo(175);
  });

  it('цель у нижнего края («Завершить день») — карточка над ней', () => {
    const end: Rect = { x: 10, y: 766, w: 370, h: 66 };
    const p = placeCard(end, CARD, PHONE);
    expect(p.side).toBe('above');
    expect(p.y + 170 + GAP).toBe(766);
    expect(overlap({ x: p.x, y: p.y, w: 340, h: 170 }, end)).toBe(0);
  });

  it('цель шире карточки — карточка в рамке, стрелка по центру карточки', () => {
    const wide: Rect = { x: -40, y: 300, w: 470, h: 40 };
    const p = placeCard(wide, CARD, PHONE);
    expect(inside(p, 340, 170, PHONE)).toBe(true);
    expect(p.arrowX).toBe(170);
  });

  it('цель у края рамки — стрелка не уходит в угол карточки', () => {
    const p = placeCard({ x: 0, y: 400, w: 20, h: 20 }, CARD, PHONE);
    expect(p.x).toBe(EDGE);
    expect(p.arrowX).toBe(22);
  });

  it('узкая рамка — карточка сжимается до рамки минус 32 px', () => {
    const narrow: Rect = { x: 0, y: 0, w: 320, h: 640 };
    const p = placeCard({ x: 100, y: 100, w: 40, h: 40 }, CARD, narrow);
    expect(p.x).toBe(EDGE);
    expect(inside(p, 320 - 2 * EDGE, 170, narrow)).toBe(true);
  });

  it('не помещается ни сверху, ни снизу — center там, где закрыто меньше', () => {
    const tall: Rect = { x: 20, y: 120, w: 350, h: 620 };
    const p = placeCard(tall, CARD, PHONE);
    expect(p.side).toBe('center');
    expect(p.arrowX).toBeNull();
    expect(inside(p, 340, 170, PHONE)).toBe(true);
    // сверху свободно 120 px, снизу 104: карточка у верхнего края закрывает меньше цели
    expect(p.y).toBe(EDGE);
  });

  it('обходит лист меню стройки', () => {
    const slot: Rect = { x: 200, y: 360, w: 70, h: 40 };
    const sheet: Rect = { x: 0, y: 520, w: 390, h: 324 };
    const p = placeCard(slot, CARD, PHONE, [sheet]);
    expect(p.side).toBe('above');
    expect(overlap({ x: p.x, y: p.y, w: 340, h: 170 }, sheet)).toBe(0);
    expect(overlap({ x: p.x, y: p.y, w: 340, h: 170 }, slot)).toBe(0);
  });

  it('прямоугольник avoid сразу под целью — карточка отодвигается за него', () => {
    const target: Rect = { x: 100, y: 100, w: 60, h: 30 };
    const block: Rect = { x: 0, y: 140, w: 390, h: 60 };
    const p = placeCard(target, CARD, PHONE, [block]);
    expect(p.side).toBe('below');
    expect(p.y).toBe(200 + GAP);
  });

  it('колонка на компьютере — карточка в пределах колонки', () => {
    const slot: Rect = { x: 900, y: 400, w: 80, h: 50 };
    const p = placeCard(slot, CARD, COLUMN);
    expect(inside(p, 340, 170, COLUMN)).toBe(true);
    expect(p.x + 340).toBeLessThanOrEqual(973 - EDGE);
  });

  it('цель вне рамки (под панелью, за краем) — по центру', () => {
    expect(placeCard({ x: 0, y: 900, w: 50, h: 50 }, CARD, PHONE).side).toBe('center');
    expect(placeCard({ x: 10, y: 10, w: 0, h: 0 }, CARD, PHONE).side).toBe('center');
  });
});
