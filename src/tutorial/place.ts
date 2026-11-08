// Положение карточки обучения у цели: чистая функция без DOM (тесты — place.test.ts).
// Координаты — в пикселях рамки #app. coach.ts зовёт placeCard на каждом кадре, пока карточка видна.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Size {
  w: number;
  h: number;
}

/** above — карточка над целью (стрелка снизу, `.at-bottom`); below — под целью (`.at-top`). */
export type CardSide = 'above' | 'below' | 'center';

export interface CardPlace {
  x: number;
  y: number;
  side: CardSide;
  /** Где стрелка по горизонтали, px от левого края карточки; у `center` стрелки нет — null. */
  arrowX: number | null;
}

/** Отступ карточки от края рамки. */
export const EDGE = 16;
/** Зазор между целью и карточкой: стрелка 8 px и воздух. */
export const GAP = 14;
/** Стрелка не подходит к углу карточки ближе этого. */
export const ARROW_PAD = 22;

const bottom = (r: Rect) => r.y + r.h;
const right = (r: Rect) => r.x + r.w;
const clamp = (v: number, lo: number, hi: number) => (hi < lo ? lo : Math.min(hi, Math.max(lo, v)));

export function overlap(a: Rect, b: Rect): number {
  const w = Math.min(right(a), right(b)) - Math.max(a.x, b.x);
  const h = Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Цель видна в рамке хотя бы частью и не нулевая. */
export function visibleIn(target: Rect, frame: Rect): boolean {
  return target.w > 0 && target.h > 0 && overlap(target, frame) > 0;
}

/**
 * Карточка ставится с той стороны цели, где больше места, не выходит за рамку (отступ EDGE) и не ложится
 * на цель и прямоугольники `avoid` (лист меню стройки): если ложится — отодвигается за них дальше от цели.
 * Не помещается ни сверху, ни снизу — `center` без стрелки там, где она меньше всего закрывает цель.
 * Без цели (или цель вне рамки) — по центру рамки.
 */
export function placeCard(
  target: Rect | null,
  card: Size,
  frame: Rect,
  avoid: readonly Rect[] = [],
): CardPlace {
  const w = Math.min(card.w, frame.w - 2 * EDGE);
  const h = card.h;
  const minX = frame.x + EDGE;
  const maxX = right(frame) - EDGE - w;
  const minY = frame.y + EDGE;
  const maxY = bottom(frame) - EDGE - h;

  if (!target || !visibleIn(target, frame)) {
    return {
      x: clamp(frame.x + (frame.w - w) / 2, minX, maxX),
      y: clamp(frame.y + (frame.h - h) / 2, minY, maxY),
      side: 'center',
      arrowX: null,
    };
  }

  const cx = target.x + target.w / 2;
  const x = clamp(cx - w / 2, minX, maxX);
  const blocks = [target, ...avoid.filter((r) => r.w > 0 && r.h > 0)];
  const at = (y: number): Rect => ({ x, y, w, h });

  // Ставим у цели и отодвигаем за каждый мешающий прямоугольник, пока не перестанет мешать.
  const tryBelow = (): number | null => {
    let y = bottom(target) + GAP;
    for (let i = 0; i <= blocks.length; i++) {
      const hit = blocks.find((b) => overlap(at(y), b) > 0);
      if (!hit) break;
      y = bottom(hit) + GAP;
    }
    return y <= maxY && !blocks.some((b) => overlap(at(y), b) > 0) ? y : null;
  };
  const tryAbove = (): number | null => {
    let y = target.y - GAP - h;
    for (let i = 0; i <= blocks.length; i++) {
      const hit = blocks.find((b) => overlap(at(y), b) > 0);
      if (!hit) break;
      y = hit.y - GAP - h;
    }
    return y >= minY && !blocks.some((b) => overlap(at(y), b) > 0) ? y : null;
  };

  const spaceAbove = target.y - frame.y;
  const spaceBelow = bottom(frame) - bottom(target);
  const order: ('above' | 'below')[] = spaceBelow >= spaceAbove ? ['below', 'above'] : ['above', 'below'];
  const arrowX = clamp(cx - x, ARROW_PAD, w - ARROW_PAD);
  for (const side of order) {
    const y = side === 'below' ? tryBelow() : tryAbove();
    if (y !== null) return { x, y, side, arrowX };
  }

  // Ни сверху, ни снизу: ставим в рамке туда, где закрыто меньше всего цели и прочего.
  const covered = (y: number) => blocks.reduce((sum, b) => sum + overlap(at(y), b), 0);
  const candidates = [
    minY,
    maxY,
    clamp(target.y - GAP - h, minY, maxY),
    clamp(bottom(target) + GAP, minY, maxY),
  ];
  let best = candidates[0] ?? minY;
  for (const y of candidates) if (covered(y) < covered(best)) best = y;
  return { x, y: best, side: 'center', arrowX: null };
}
