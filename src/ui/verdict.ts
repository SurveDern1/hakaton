// Экран итога перед финалом: «Вы выжили!» или «Вы умерли…» по макету «Экран проигрыша и выигрыша».
// Картинка — фон без текста (public/verdict/*), надпись живым текстом из data/endings.json
// (verdicts, у концовки — verdict). Порядок в main.ts: эпилог-комикс → showVerdict → showFinal.
import type { Verdict } from '../core';
import { h } from './format';
import './verdict.css';

const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`;

/** Касание, клик, Enter, пробел или Esc — дальше. Первые 0,6 с ввод не принимается, чтобы
 *  случайное касание после ночи не пролистнуло экран. */
const GUARD_MS = 600;
const LEAVE_MS = 320;

export function showVerdict(root: HTMLElement, kind: 'win' | 'lose', v: Verdict): Promise<void> {
  return new Promise((resolve) => {
    const next = h('button', { type: 'button', class: 'btn vd-next' }, 'Дальше');
    const layer = h(
      'div',
      {
        class: `vd vd-${kind} vd-at-${v.at}`,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'vd-title',
        'aria-describedby': 'vd-text',
      },
      h('img', { class: 'vd-art', src: asset(v.image), alt: v.alt, draggable: 'false' }),
      h(
        'div',
        { class: 'vd-words' },
        h('h1', { class: 'vd-title', id: 'vd-title' }, v.title),
        h('p', { class: 'vd-text', id: 'vd-text' }, v.text),
      ),
      next,
    );
    const shownAt = performance.now();
    let done = false;
    const finish = () => {
      if (done || performance.now() - shownAt < GUARD_MS) return;
      done = true;
      document.removeEventListener('keydown', onKey);
      layer.classList.add('is-leaving');
      window.setTimeout(() => {
        layer.remove();
        resolve();
      }, LEAVE_MS);
    };
    const onKey = (e: KeyboardEvent) => {
      if (['Enter', ' ', 'Escape', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        finish();
      }
    };
    layer.addEventListener('click', finish);
    document.addEventListener('keydown', onKey);
    root.append(layer);
    next.focus({ preventScroll: true });
  });
}
