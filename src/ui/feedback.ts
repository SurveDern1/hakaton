// Видимое подтверждение действий: всплывающие числа над плитками HUD (data-key) и строка статуса.
// Числа и вспышка — классы .ev-float / .ev-flash из event-window.css; статус — .status-line в game.css.

/** Место под всплывающим числом ниже плитки, px. */
const FLOAT_H = 32;

const overlaps = (a: DOMRect, b: DOMRect) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/**
 * Всплывающее число над плиткой `[data-key=key]`. false — плитки нет, она скрыта (вкладка на телефоне),
 * вне рамки #app или её вместе с местом под числом закрывает один из прямоугольников `covered`
 * (карточка реплики): тогда вызывающий показывает изменение строкой в своём окне.
 */
export function flashHud(
  root: HTMLElement,
  floats: HTMLElement,
  key: string,
  delta: number,
  text: string,
  covered: DOMRect[] = [],
): boolean {
  const target = [...root.querySelectorAll<HTMLElement>(`[data-key="${key}"]`)].find(
    (t) => t.getClientRects().length > 0 && t.getBoundingClientRect().width > 0,
  );
  if (!target) return false;
  const r = target.getBoundingClientRect();
  const zone = new DOMRect(r.left, r.top, r.width, r.height + FLOAT_H);
  const frame = (document.getElementById('app') ?? document.body).getBoundingClientRect();
  if (zone.top < frame.top || zone.bottom > frame.bottom || covered.some((c) => overlaps(zone, c)))
    return false;
  const f = document.createElement('span');
  f.className = `ev-float ${delta > 0 ? 'up' : 'down'} num`;
  f.textContent = text;
  // Слой чисел лежит в рамке #app, а не в углу окна — координаты от его края
  const o = floats.getBoundingClientRect();
  f.style.left = `${r.left - o.left + r.width / 2}px`;
  f.style.top = `${r.bottom - o.top}px`;
  floats.append(f);
  target.classList.remove('ev-flash');
  void target.offsetWidth;
  target.classList.add('ev-flash');
  window.setTimeout(() => f.remove(), 1800);
  window.setTimeout(() => target.classList.remove('ev-flash'), 1200);
  return true;
}

export interface StatusLine {
  /** Короткое подтверждение: «Построено: Ферма». Ошибка — tone 'bad', без анимации успеха. */
  say(text: string, tone?: 'good' | 'bad' | 'info'): void;
}

/** Строка статуса внизу экрана (role=status): текст держится ~3,6 с (ошибка ~4,8 с), затем уходит. */
export function mountStatus(root: HTMLElement): StatusLine {
  const line = document.createElement('div');
  line.className = 'status-line';
  line.setAttribute('role', 'status');
  line.setAttribute('aria-live', 'polite');
  root.append(line);
  let timer = 0;
  return {
    say(text, tone = 'good') {
      window.clearTimeout(timer);
      line.textContent = text;
      line.dataset.tone = tone;
      line.classList.remove('is-on');
      void line.offsetWidth;
      line.classList.add('is-on');
      timer = window.setTimeout(() => line.classList.remove('is-on'), tone === 'bad' ? 4800 : 3600);
    },
  };
}
