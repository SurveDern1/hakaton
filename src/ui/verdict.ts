// Экран итога перед финалом: «Вы выжили!» или «Вы умерли…» по макету «Экран проигрыша и выигрыша».
// Картинка — фон без текста (public/verdict/*), надпись живым текстом из data/endings.json
// (verdicts, у концовки — verdict). Порядок в main.ts: эпилог-комикс → showVerdict → showFinal.
// Под надписью — три итога партии (verdictStats): плитки проявляются по очереди, числа считают от нуля.
import type { GameState, Verdict } from '../core';
import { fmtNum, h, plural } from './format';
import './verdict.css';

const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`;

/** Касание, клик, Enter, пробел или Esc — дальше. Первые 0,6 с ввод не принимается, чтобы
 *  случайное касание после ночи не пролистнуло экран. */
const GUARD_MS = 600;
const LEAVE_MS = 320;
/** Первая плитка итогов — после подзаголовка; следующие — с шагом STAT_STEP_MS. */
const STAT_DELAY_MS = 1300;
const STAT_STEP_MS = 220;
const COUNT_MS = 1100;

export interface VerdictStat {
  value: number;
  unit?: string;
  label: string;
}

/** Итоги партии: сколько дней продержались (ночь поражения уже прибавила день), сколько людей, высота. */
export function verdictStats(state: GameState, kind: 'win' | 'lose'): VerdictStat[] {
  const days = Math.max(0, kind === 'lose' ? state.day - 1 : state.day);
  const pop = Math.max(0, state.res.pop);
  return [
    {
      value: days,
      label: `${plural(days, 'день', 'дня', 'дней')} ${kind === 'lose' ? 'продержались' : 'в небе'}`,
    },
    { value: pop, label: plural(pop, 'выживший', 'выживших', 'выживших') },
    { value: Math.round(state.altitude), unit: 'м', label: 'высота башни' },
  ];
}

const withUnit = (n: number, unit?: string) => `${fmtNum(n)}${unit ? ` ${unit}` : ''}`;

/** Плитка итога; count() запускает счёт от нуля в момент её появления (без движения — сразу итог). */
function statTile(s: VerdictStat, i: number): { el: HTMLElement; count: () => void } {
  const delay = STAT_DELAY_MS + i * STAT_STEP_MS;
  const num = h('span', { class: 'vd-stat-num num', 'aria-hidden': 'true' }, withUnit(0, s.unit));
  const el = h(
    'li',
    { class: 'vd-stat', style: `animation-delay: ${delay}ms` },
    num,
    h('span', { class: 'vd-stat-lbl', 'aria-hidden': 'true' }, s.label),
    h('span', { class: 'vd-sr' }, `${withUnit(s.value, s.unit)} — ${s.label}`),
  );
  const count = () => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || s.value === 0) {
      num.textContent = withUnit(s.value, s.unit);
      return;
    }
    const t0 = performance.now() + delay;
    const tick = (now: number) => {
      if (!num.isConnected) return;
      const k = Math.min(1, Math.max(0, (now - t0) / COUNT_MS));
      num.textContent = withUnit(Math.round(s.value * (1 - (1 - k) ** 3)), s.unit);
      if (k < 1) requestAnimationFrame(tick);
      else num.classList.add('is-done');
    };
    requestAnimationFrame(tick);
  };
  return { el, count };
}

export function showVerdict(
  root: HTMLElement,
  kind: 'win' | 'lose',
  v: Verdict,
  stats: VerdictStat[] = [],
): Promise<void> {
  return new Promise((resolve) => {
    const next = h('button', { type: 'button', class: 'btn vd-next' }, 'Дальше');
    const tiles = stats.map(statTile);
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
        ...(tiles.length
          ? [h('ul', { class: 'vd-stats', 'aria-label': 'Итоги' }, ...tiles.map((t) => t.el))]
          : []),
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
    for (const t of tiles) t.count();
    next.focus({ preventScroll: true });
  });
}
