// Окно «Памятка» — бумажный лист в стиле стенгазеты (src/ui/paper.ts): пройденные подсказки по
// разделам (buildMemo из memo.ts). Открывает пункт меню игры (index.ts → menuItems), в консоли —
// sedmaya.tutorial.memo.open(). Закрывается «Закрыть», Esc или касанием мимо листа; уход 200 мс.
// Слой .pp-layer — у звука это «бумага» (src/audio/index.ts), класса .ev-layer нет: обучение не
// примет памятку за окно события.
import { dispText, h } from '../ui/format';
import type { Memo } from './memo';
import './memo.css';

export interface MemoWindow {
  open(memo: Memo, opts?: { off?: boolean }): void;
  close(): void;
  readonly isOpen: boolean;
}

export const MEMO_LEAVE_MS = 200;

export function mountMemoWindow(root: HTMLElement, voice: string): MemoWindow {
  let layer: HTMLElement | null = null;
  let returnFocus: HTMLElement | null = null;

  function close() {
    if (!layer) return;
    const l = layer;
    layer = null;
    l.classList.add('is-leaving');
    window.setTimeout(() => l.remove(), MEMO_LEAVE_MS);
    returnFocus?.focus?.({ preventScroll: true });
  }

  function open(memo: Memo, opts: { off?: boolean } = {}) {
    if (layer) {
      layer.remove();
      layer = null;
    }
    returnFocus = document.activeElement as HTMLElement | null;
    const body = h('div', { class: 'memo-body' });
    if (!memo.sections.length) {
      body.append(
        h(
          'p',
          { class: 'serif memo-empty' },
          'Пока пусто. Подсказки появятся по ходу игры, а прочитанные соберутся здесь.',
        ),
      );
    }
    for (const sec of memo.sections) {
      body.append(
        h(
          'section',
          { class: 'memo-sec', 'aria-labelledby': `memo-${sec.id}` },
          h('h2', { class: 'memo-sec-title', id: `memo-${sec.id}` }, sec.title),
          ...sec.entries.map((e) =>
            h(
              'article',
              { class: 'memo-item' },
              h('h3', { class: 'memo-item-title' }, e.title),
              ...e.texts.map((t) => h('p', { class: 'serif memo-text' }, t)),
            ),
          ),
        ),
      );
    }
    if (opts.off) {
      body.append(h('p', { class: 'memo-off' }, 'Подсказки выключены. Включить — в меню игры.'));
    }
    const closeBtn = h('button', { type: 'button', class: 'btn ink small memo-close' }, 'Закрыть');
    closeBtn.addEventListener('click', close);
    const sheet = h(
      'section',
      {
        class: 'paper memo',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'memo-title',
        tabindex: '-1',
      },
      h('div', { class: 'pp-tape l' }),
      h(
        'header',
        { class: 'memo-head' },
        h(
          'div',
          {},
          h('span', { class: 'lbl' }, voice),
          h('h1', { class: 'disp memo-title', id: 'memo-title' }, dispText('Памятка')),
        ),
        h('span', { class: 'plaque ink num memo-count' }, `${memo.done} из ${memo.total}`),
      ),
      body,
      closeBtn,
    );
    const l = h('div', { class: 'pp-layer memo-layer' }, h('div', { class: 'memo-backdrop' }), sheet);
    l.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('memo-backdrop')) close();
    });
    l.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      } else if (e.key === 'Tab') {
        // Единственная кнопка — фокус остаётся в окне
        e.preventDefault();
        closeBtn.focus();
      }
    });
    layer = l;
    root.append(l);
    closeBtn.focus({ preventScroll: true });
  }

  return {
    open,
    close,
    get isOpen() {
      return !!layer;
    },
  };
}
