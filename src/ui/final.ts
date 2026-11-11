// Экран финала по Final.dc.html: открытка с башней в последнем состоянии, текст концовки
// (resolveEnding), ключевые решения из state.log, судьбы (characterFates), характеристика на Председателя
// (chairReference) и значки (earnedAwards) из endings.json, закрывшиеся пути, «Начать новую пятилетку»
// и архив кристаллов памяти.
import {
  chairReference,
  characterFates,
  earnedAwards,
  type GameData,
  type GameState,
  resolveEnding,
} from '../core';
import { TowerDom } from '../scenes/tower-dom';
import { buildTower, towerInputFromState } from '../scenes/tower-model';
import { dayDate, dispText, fmtDate, h, plural } from './format';
import { portraitOf } from './portraits';

export interface FinalOptions {
  data: GameData;
  onRestart(): void;
}

/**
 * Башня как картинка: модель → разметка .tw, вписанная в рамку fit × hgt по центру полосы box × hgt.
 * Полоса шире открытки и обрезается её краем: без маски поверх анимаций (на телефоне маска
 * перерисовывает всю картинку каждый кадр).
 */
function towerPicture(state: GameState, data: GameData, box: number, fit: number, hgt: number): HTMLElement {
  const model = buildTower(towerInputFromState(state, data.balance));
  const dom = new TowerDom(() => false);
  dom.apply(model, false);
  const b = model.bounds;
  const z = Math.min(fit / b.w, hgt / b.h);
  const inner = h('div', { class: 'fin-tower-in' });
  inner.style.transform = `translate(${box / 2 - (b.x + b.w / 2) * z}px, ${hgt / 2 - (b.y + b.h / 2) * z}px) scale(${z})`;
  inner.append(dom.root);
  const el = h('div', { class: 'fin-tower', 'aria-hidden': 'true' }, inner);
  el.style.width = `${box}px`;
  el.style.height = `${hgt}px`;
  el.style.marginLeft = `${-box / 2}px`;
  return el;
}

/** Самое длинное слово заголовка: по нему кегль подгоняется под ширину открытки (game.css, .fin-title). */
function longestWord(text: string): number {
  return Math.max(1, ...text.split(/\s+/).map((w) => [...w].length));
}

/** Пути, которые закрылись к финалу, с причиной (ТЗ 6.9). */
function closedPaths(state: GameState, data: GameData, reached: string): string[] {
  const t = data.balance.endings;
  const s = state.stats;
  const out: string[] = [];
  if (reached !== 'harbor') {
    if (state.flags.includes('dropped_lower')) out.push('Гавань · сбросили нижний ярус');
    else if (s.solidarity < t.harborSolidarity) out.push(`Гавань · солидарность ниже ${t.harborSolidarity}`);
  }
  if (reached !== 'seal') {
    if (!state.flags.includes('seal_open')) out.push('Жертва · ключ к разлому не нашли');
    else if (s.trust < t.sealTrust) out.push(`Жертва · доверие ниже ${t.sealTrust}`);
  }
  if (reached !== 'fortress' && s.order < t.fortressOrder)
    out.push(`Крепость · порядок ниже ${t.fortressOrder}`);
  return out;
}

/** Концовка партии; путь не выбран — башня держится дальше одна. */
export function finalEnding(state: GameState, data: GameData) {
  const ending = resolveEnding(state, data) ?? resolveEnding({ ...state, ending: 'hold' }, data);
  if (!ending) throw new Error('Нет концовки');
  return ending;
}

export function showFinal(root: HTMLElement, state: GameState, opts: FinalOptions): HTMLElement {
  const { data } = opts;
  const ending = finalEnding(state, data);
  const all = data.endings.endings;
  const index = all.findIndex((e) => e.id === ending.id) + 1;
  const date = dayDate(data, state.day);
  const pop = state.res.pop;
  const paras = ending.text.split(/\n\s*\n/);

  // Решения: первая запись каждого дня — выбор утра; не больше восьми последних
  const byDay = new Map<number, string>();
  for (const e of state.log) if (!byDay.has(e.day)) byDay.set(e.day, e.text);
  const decisions = [...byDay.entries()].slice(-8);

  const memories = data.endings.memories.slice(0, state.memories);
  const archive = h(
    'div',
    { class: 'fin-archive', hidden: true, id: 'fin-archive' },
    ...(memories.length
      ? memories.map((m) =>
          m.image
            ? h(
                'figure',
                { class: 'fin-memory' },
                h('img', { src: m.image, alt: '' }),
                h('figcaption', { class: 'serif' }, h('b', {}, `${m.who}: `), m.text),
              )
            : h('p', { class: 'serif' }, h('b', {}, `${m.who}: `), m.text),
        )
      : [h('p', { class: 'serif' }, 'Кристаллов памяти не нашли.')]),
  );
  const again = h('button', { type: 'button', class: 'btn fin-again' }, 'Начать новую пятилетку');
  const crystals = h(
    'button',
    { type: 'button', class: 'btn ink', 'aria-expanded': 'false', 'aria-controls': 'fin-archive' },
    `Архив кристаллов · ${state.memories} из ${data.endings.memories.length}`,
  );
  again.addEventListener('click', () => {
    layer.classList.add('is-leaving');
    window.setTimeout(() => {
      layer.remove();
      opts.onRestart();
    }, 220);
  });
  crystals.addEventListener('click', () => {
    archive.hidden = !archive.hidden;
    crystals.setAttribute('aria-expanded', String(!archive.hidden));
  });

  const closed = closedPaths(state, data, ending.id);
  const reference = chairReference(state, data, ending.id);
  const awards = earnedAwards(state, data);
  const poster = h(
    'figure',
    { class: `fin-poster poster-${ending.poster ?? ending.id}` },
    h('div', { class: 'fin-band a' }),
    h('div', { class: 'fin-band b' }),
    h(
      'span',
      { class: 'plaque ink num fin-date' },
      fmtDate(date, { day: 'numeric', month: 'long', year: 'numeric' }).replace(' г.', ''),
    ),
    towerPicture(state, data, 560, 300, 560),
    h(
      'figcaption',
      {},
      h(
        'span',
        { class: 'disp fin-title', id: 'fin-title', style: `--len:${longestWord(ending.title)}` },
        dispText(ending.title),
      ),
      h(
        'span',
        { class: 'num fin-sub' },
        `${fmtDate(date)}. ${state.day} ${plural(state.day, 'день', 'дня', 'дней')}. ${pop} ${plural(pop, 'выживший', 'выживших', 'выживших')}.`,
      ),
    ),
  );
  const side = h(
    'div',
    { class: 'fin-side' },
    h('span', { class: 'plaque fin-kicker' }, `Концовка · ${index} из ${all.length}`),
    ending.harborRefused && h('p', { class: 'serif fin-refused' }, ending.harborRefused),
    ...paras.map((p) => h('p', { class: 'serif fin-text' }, p)),
    h(
      'div',
      { class: 'fin-cols' },
      h(
        'section',
        {},
        h('span', { class: 'lbl' }, 'Ключевые решения'),
        h(
          'div',
          { class: 'fin-grid' },
          ...decisions.flatMap(([d, t]) => [
            h('span', { class: 'num fin-day' }, `День ${d}`),
            h('span', {}, t),
          ]),
        ),
      ),
      h(
        'section',
        {},
        h('span', { class: 'lbl' }, 'Судьбы'),
        h(
          'div',
          { class: 'fin-grid fates' },
          ...characterFates(state, data).flatMap((f) => [
            h('b', {}, portraitOf(f.who).name),
            h('span', {}, f.text),
          ]),
        ),
      ),
    ),
    reference.length > 0 &&
      h(
        'section',
        { class: 'fin-ref' },
        h('span', { class: 'lbl' }, 'Характеристика на Председателя Совета башни'),
        h('p', { class: 'serif' }, reference.join(' ')),
        h('span', { class: 'fin-stamp', 'aria-hidden': 'true' }, 'Совет башни «Седьмое ноября»'),
      ),
    awards.length > 0 &&
      h(
        'section',
        { class: 'fin-sep' },
        h('span', { class: 'lbl' }, 'Значки'),
        h(
          'div',
          { class: 'fin-awards' },
          ...awards.map((a) =>
            h('span', { class: 'fin-award', title: a.text }, h('b', {}, a.title), h('small', {}, a.text)),
          ),
        ),
      ),
    closed.length > 0 &&
      h(
        'section',
        { class: 'fin-sep' },
        h('span', { class: 'lbl' }, 'Пути, которые закрылись'),
        h('div', { class: 'fin-closed' }, ...closed.map((c) => h('span', {}, c))),
      ),
    h('div', { class: 'fin-actions' }, again, crystals),
    archive,
  );
  const layer = h(
    'div',
    { class: 'fin-layer', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'fin-title' },
    h('div', { class: 'fin' }, poster, side),
  );
  root.append(layer);
  again.focus({ preventScroll: true });
  return layer;
}
