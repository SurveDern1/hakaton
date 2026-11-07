// Стартовый экран (ТЗ 9, 3.2): «Всем! Всем! Всем!», «Продолжить» при сохранении и «Новая игра».
import type { GameData, GameState } from '../core';
import { dayDate, fmtDate, h } from './format';

export interface StartOptions {
  data: GameData;
  saved: GameState | null;
  onNew(): void;
  onContinue(state: GameState): void;
  /** Окно «Настройки» (src/audio/settings-window.ts); без него кнопки нет. */
  onSettings?(): void;
}

export function showStart(root: HTMLElement, opts: StartOptions): HTMLElement {
  const { data, saved } = opts;
  const leave = (then: () => void) => {
    layer.classList.add('is-leaving');
    window.setTimeout(() => {
      layer.remove();
      then();
    }, 240);
  };
  const fresh = h(
    'button',
    { type: 'button', class: `btn${saved ? ' ink' : ''}` },
    saved ? 'Новая игра' : 'Начать',
  );
  fresh.addEventListener('click', () => leave(opts.onNew), { once: true });
  const buttons: HTMLElement[] = [];
  if (saved) {
    const cont = h(
      'button',
      { type: 'button', class: 'btn' },
      `Продолжить · день ${saved.day}, ${fmtDate(dayDate(data, saved.day))}`,
    );
    cont.addEventListener('click', () => leave(() => opts.onContinue(saved)), { once: true });
    buttons.push(cont);
  }
  buttons.push(fresh);
  if (opts.onSettings) {
    const settings = h('button', { type: 'button', class: 'btn ink start-settings' }, 'Настройки');
    settings.addEventListener('click', () => opts.onSettings?.());
    buttons.push(settings);
  }

  const layer = h(
    'div',
    { class: 'start', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'start-title' },
    h(
      'div',
      { class: 'start-in' },
      h('span', { class: 'lbl start-radio' }, 'Радио башни · 19 октября 1967'),
      h('p', { class: 'disp start-call' }, 'Всем! Всем! Всем!'),
      h('h1', { class: 'disp start-title', id: 'start-title' }, 'Седьмая'),
      h(
        'p',
        { class: 'serif start-text' },
        'Летающая башня «Седьмое ноября» держится над Мглой. Эфира мало, людей всё больше, туман поднимается каждую ночь. До праздника двадцать дней.',
      ),
      h('div', { class: 'start-actions' }, ...buttons),
    ),
  );
  root.append(layer);
  buttons[0]?.focus({ preventScroll: true });
  return layer;
}
