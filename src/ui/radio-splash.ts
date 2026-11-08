// Заставка «Включить радио» перед стартовым экраном (план звука, Р1): тёмный экран, большая кнопка и
// тихая ссылка «Играть без звука». Нажатие кнопки — первый жест: звук разблокируется (onRadio), слой
// уходит за 240 мс, дальше стартовый экран и радио «Всем! Всем! Всем!» (src/audio/index.ts → radioIntro).
// Показывается, только если в настройках звук не выключен (main.ts). Вид — как у стартового экрана (.start).
import { h } from './format';

export interface RadioSplashOptions {
  /** Включить радио: вызывается внутри жеста (клик, Enter, пробел) — здесь звук и запускается. */
  onRadio(): void;
  /** Играть без звука. */
  onSilent(): void;
}

/** Уход слоя, мс: как у .start.is-leaving. */
const LEAVE_MS = 240;

export function showRadioSplash(root: HTMLElement, opts: RadioSplashOptions): Promise<'radio' | 'silent'> {
  return new Promise((done) => {
    const on = h(
      'button',
      { type: 'button', class: 'btn rs-on', 'aria-label': 'Включить радио — игра со звуком' },
      h('span', { class: 'rs-dial', 'aria-hidden': 'true' }),
      'Включить радио',
    );
    const silent = h('button', { type: 'button', class: 'rs-silent' }, 'Играть без звука');
    const layer = h(
      'div',
      { class: 'start rs', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'rs-title' },
      h(
        'div',
        { class: 'start-in rs-in' },
        h('span', { class: 'lbl start-radio' }, 'Радио башни · 19 октября 1967'),
        h('h1', { class: 'disp rs-title', id: 'rs-title' }, 'Седьмая на связи'),
        h('p', { class: 'serif rs-text' }, 'Игра звучит: ветер, двигатель, радио. Лучше в наушниках.'),
        on,
        silent,
      ),
    );
    let left = false;
    const leave = (how: 'radio' | 'silent') => {
      if (left) return;
      left = true;
      // звук запускается сразу, в самом жесте: иначе браузер телефона его не разрешит
      if (how === 'radio') opts.onRadio();
      else opts.onSilent();
      layer.classList.add('is-leaving');
      window.setTimeout(() => {
        layer.remove();
        done(how);
      }, LEAVE_MS);
    };
    on.addEventListener('click', () => leave('radio'));
    silent.addEventListener('click', () => leave('silent'));
    root.append(layer);
    on.focus({ preventScroll: true });
  });
}
