// Окно утреннего события (макет design/project/Event.dc.html) поверх башни.
// Порядок: showMorning(ids) → для каждого события show(id): окно появляется, игрок выбирает
// вариант (мышь, Tab/Enter или цифра) → карточка подсвечивается → store.dispatch(applyChoice) →
// окно уходит → реплика персонажа у края и всплывающие числа над шкалами HUD → следующее окно.
import {
  applyChoice,
  type ChoicePreview,
  type ChoiceResult,
  choiceAvailability,
  type EffectKey,
  eventText,
  type FactionKey,
  type GameData,
  type GameEvent,
  previewChoice,
} from '../core';
import type { GameStore } from '../game/store';
import { flashHud } from './feedback';
import { FACTION_ICONS, portraitOf, svgIcon } from './portraits';
import './event-window.css';

/** Полоса отчёта о ночи над первым окном утра. */
export interface MorningReport {
  /** «Отчёт о ночи на 20 октября». */
  title: string;
  items: string[];
}

export type DeltaKey = EffectKey | FactionKey;

/** Одна стрелка подсказки: направление и сила 1–3, у фракций — только знак. */
interface PreviewHint {
  key: DeltaKey;
  kind: 'res' | 'stat' | 'world' | 'faction';
  dir: 1 | -1;
  level: number;
}

/** Итоговое изменение после выбора — для чисел над HUD и карточки реплики. */
export interface ChoiceDelta {
  key: DeltaKey;
  kind: PreviewHint['kind'];
  delta: number;
}

/** Стрелки core (ChoicePreview) → подсказки окна в порядке: показатели, ресурсы, мир, фракции. */
function hintsOf(p: ChoicePreview): PreviewHint[] {
  const out: PreviewHint[] = [];
  for (const a of p.stats)
    out.push({ key: a.key, kind: 'stat', dir: a.dir === 'up' ? 1 : -1, level: a.level });
  for (const a of p.res) {
    const kind = a.key === 'altitude' || a.key === 'mist' ? 'world' : 'res';
    out.push({ key: a.key, kind, dir: a.dir === 'up' ? 1 : -1, level: a.level });
  }
  for (const f of p.factions)
    out.push({ key: f.key, kind: 'faction', dir: f.sign === '+' ? 1 : -1, level: 1 });
  return out;
}

/** Изменения из ChoiceResult списком; нули не попадают. */
export function deltasOf(r: ChoiceResult): ChoiceDelta[] {
  const out: ChoiceDelta[] = [];
  for (const [key, delta] of Object.entries(r.deltas.res))
    if (delta) out.push({ key: key as DeltaKey, kind: 'res', delta });
  for (const [key, delta] of Object.entries(r.deltas.stats))
    if (delta) out.push({ key: key as DeltaKey, kind: 'stat', delta });
  if (r.deltas.altitude) out.push({ key: 'altitude', kind: 'world', delta: r.deltas.altitude });
  if (r.deltas.mist) out.push({ key: 'mist', kind: 'world', delta: r.deltas.mist });
  for (const [key, delta] of Object.entries(r.deltas.factions))
    if (delta) out.push({ key: key as DeltaKey, kind: 'faction', delta });
  return out;
}

export interface EventWindowOptions {
  store: GameStore;
  data: GameData;
}

export interface EventWindow {
  /** Показать одно событие; промис — после выбора и реплики. */
  show(eventId: string, report?: MorningReport): Promise<ChoiceResult>;
  /** Очередь утра: не больше balance.events.maxWindowsPerMorning окон подряд. */
  showMorning(eventIds: string[], report?: MorningReport): Promise<ChoiceResult[]>;
  readonly isOpen: boolean;
}

export const DELTA_LABELS: Record<DeltaKey, string> = {
  pop: 'Жители',
  food: 'Еда',
  ether: 'Эфир',
  mat: 'Материалы',
  trust: 'Доверие',
  solidarity: 'Солидарность',
  health: 'Здоровье',
  order: 'Порядок',
  altitude: 'Высота',
  mist: 'Мгла',
  stokers: 'Кочегары',
  institute: 'Институт',
  mistborn: 'Туманники',
  sky: 'Дети Неба',
};

const LEVEL_WORDS = ['немного', 'заметно', 'сильно'];

// Длительности интерфейса, мс (не баланс): появление/уход окна, подсветка выбора, реплика.
const T_CHOSEN = 300;
const T_LEAVE = 200;
const T_REPLY = 2600;

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

type Child = Node | string | null | undefined | false;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) if (c) node.append(c);
  return node;
}

function svgNode(markup: string, cls: string): HTMLElement {
  const span = el('span', { class: cls, 'aria-hidden': 'true' });
  span.innerHTML = markup;
  return span;
}

export const fmtSigned = (n: number, key: DeltaKey) => {
  const abs = Math.abs(n).toLocaleString('ru-RU', { maximumFractionDigits: 1 });
  const unit = key === 'altitude' || key === 'mist' ? ' м' : '';
  return `${n > 0 ? '+' : '−'}${abs}${unit}`;
};

function dayLabel(data: GameData, day: number): string {
  const date = new Date(`${data.balance.calendar.firstDay}T00:00:00`);
  date.setDate(date.getDate() + day - 1);
  return `День ${day} · ${date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`;
}

function hintChip(h: PreviewHint): HTMLElement {
  const name = DELTA_LABELS[h.key];
  if (h.kind === 'faction') {
    const chip = el(
      'span',
      { class: 'hint', 'aria-label': `${name}: ${h.dir > 0 ? 'одобрят' : 'не одобрят'}` },
      svgNode(svgIcon(FACTION_ICONS[h.key] ?? ''), 'hint-ico'),
      name,
      el('span', { class: h.dir > 0 ? 'up' : 'down' }, h.dir > 0 ? '+' : '−'),
    );
    return chip;
  }
  const arrows = (h.dir > 0 ? '↑' : '↓').repeat(h.level);
  return el(
    'span',
    { class: 'hint', 'aria-label': `${name}: ${LEVEL_WORDS[h.level - 1]} ${h.dir > 0 ? 'вверх' : 'вниз'}` },
    name,
    el('span', { class: h.dir > 0 ? 'up' : 'down', 'aria-hidden': 'true' }, arrows),
  );
}

export function mountEventWindow(root: HTMLElement, opts: EventWindowOptions): EventWindow {
  const { store, data } = opts;
  let open = false;
  let uid = 0;

  const floats = el('div', { class: 'ev-floats', 'aria-hidden': 'true' });
  const replyZone = el('div', { class: 'ev-replies', role: 'status', 'aria-live': 'polite' });
  root.append(floats, replyZone);

  function buildDialog(event: GameEvent, report: MorningReport | undefined, choose: (i: number) => void) {
    const state = store.state;
    const id = `ev-${++uid}`;
    const p = portraitOf(event.portrait);

    const poster = el(
      'div',
      { class: `ev-poster tone-${p.tone}` },
      el('div', { class: 'ev-stripe ev-stripe-a' }),
      el('div', { class: 'ev-stripe ev-stripe-b' }),
      (() => {
        const n = svgNode(
          `<svg viewBox="0 0 300 380" role="img" aria-label="${p.name}">${p.emblem}</svg>`,
          'ev-emblem',
        );
        n.removeAttribute('aria-hidden');
        return n;
      })(),
      el('span', { class: 'plaque ink ev-date num' }, dayLabel(data, state.day)),
      el(
        'div',
        { class: 'ev-caption' },
        el('span', { class: 'ev-kicker' }, p.kicker),
        el('span', { class: 'disp ev-name' }, p.name),
        p.quote && el('span', { class: 'serif ev-quote' }, p.quote),
      ),
    );

    const reportStrip =
      report &&
      el(
        'div',
        { class: 'ev-report' },
        el('span', { class: 'lbl' }, report.title),
        ...report.items.map((t) => el('span', { class: 'num' }, t)),
      );

    const text = el(
      'div',
      { class: 'serif ev-text', id: `${id}-text` },
      ...eventText(state, event)
        .split(/\n\s*\n/)
        .map((para) => el('p', {}, para)),
    );

    const buttons: HTMLButtonElement[] = [];
    const list = el('div', { class: 'ev-choices', role: 'group', 'aria-label': 'Варианты решения' });
    let n = 0;
    event.choices.forEach((choice, i) => {
      const av = choiceAvailability(state, choice);
      if (!av.visible) return;
      n += 1;
      const pv = previewChoice(state, data, event.id, i);
      const enabled = av.available;
      const detailId = `${id}-c${i}`;
      const details = el('span', { class: 'ev-hints', id: detailId });
      if (enabled) {
        for (const h of hintsOf(pv)) details.append(hintChip(h));
        if (pv.remembered) details.append(el('span', { class: 'hint memory' }, '⧗ это запомнят'));
      } else {
        details.append(
          el(
            'span',
            { class: 'ev-lock' },
            svgNode(
              svgIcon(
                '<rect x="5" y="11" width="14" height="10" rx="1"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
              ),
              '',
            ),
            av.reason ?? 'Недоступно',
          ),
        );
      }
      const btn = el(
        'button',
        {
          type: 'button',
          class: `ev-choice${enabled ? '' : ' is-off'}${av.status === 'locked' ? ' is-locked' : ''}`,
          'data-choice': String(i),
          'aria-describedby': detailId,
          ...(enabled ? {} : { 'aria-disabled': 'true' }),
        },
        el('span', { class: 'disp ev-num', 'aria-hidden': 'true' }, String(n)),
        el('span', { class: 'ev-label' }, choice.label),
        details,
      );
      btn.addEventListener('click', () => {
        if (btn.getAttribute('aria-disabled') !== 'true') choose(i);
      });
      buttons.push(btn);
      list.append(btn);
    });

    const legend = el(
      'div',
      { class: 'ev-legend' },
      el('span', {}, el('b', {}, '↑'), ' немного'),
      el('span', {}, el('b', {}, '↑↑'), ' заметно'),
      el('span', {}, el('b', {}, '↑↑↑'), ' сильно'),
      el('span', {}, el('b', {}, '⧗'), ' последствия придут позже'),
      el('span', {}, 'Фракции показаны, если изменение заметное'),
    );

    const dialog = el(
      'section',
      {
        class: 'ev',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': `${id}-title`,
        'aria-describedby': `${id}-text`,
        tabindex: '-1',
      },
      poster,
      el(
        'div',
        { class: 'paper ev-body' },
        reportStrip,
        el(
          'div',
          { class: 'ev-main' },
          el('h1', { class: 'disp ev-title', id: `${id}-title` }, event.title),
          text,
          list,
          legend,
        ),
      ),
    );
    const layer = el('div', { class: 'ev-layer' }, el('div', { class: 'ev-backdrop' }), dialog);
    return { layer, dialog, buttons };
  }

  async function feedback(result: ChoiceResult) {
    // Числа над шкалами HUD; то, чего на HUD нет (фракции, высота), — в карточке реплики.
    const rest = deltasOf(result).filter(
      (d) => !flashHud(root, floats, d.key, d.delta, fmtSigned(d.delta, d.key)),
    );
    const who = result.reply ? portraitOf(result.reply.who) : null;
    const card = el(
      'div',
      { class: `ev-reply${who ? '' : ' no-who'}` },
      who && svgNode(`<svg viewBox="0 0 300 380">${who.emblem}</svg>`, `ev-reply-face tone-${who.tone}`),
      el(
        'div',
        { class: 'ev-reply-body' },
        who && result.reply && el('span', { class: 'ev-reply-who' }, who.name),
        result.reply && el('p', { class: 'serif ev-reply-text' }, `«${result.reply.text}»`),
        el('p', { class: 'ev-reply-log' }, result.log.join(' ')),
        rest.length > 0 &&
          el(
            'span',
            { class: 'ev-reply-deltas' },
            ...rest.map((d) =>
              el(
                'span',
                { class: `hint dark num` },
                d.kind === 'faction' && svgNode(svgIcon(FACTION_ICONS[d.key] ?? ''), 'hint-ico'),
                DELTA_LABELS[d.key],
                el('span', { class: d.delta > 0 ? 'up' : 'down' }, fmtSigned(d.delta, d.key)),
              ),
            ),
          ),
      ),
    );
    replyZone.append(card);
    await wait(T_REPLY);
    card.classList.add('is-leaving');
    await wait(T_LEAVE);
    card.remove();
  }

  function show(eventId: string, report?: MorningReport): Promise<ChoiceResult> {
    const event = data.events.find((e) => e.id === eventId);
    if (!event) return Promise.reject(new Error(`Нет события ${eventId}`));
    open = true;
    const returnFocus = document.activeElement as HTMLElement | null;

    return new Promise<ChoiceResult>((resolve) => {
      let chosen = false;
      const { layer, dialog, buttons } = buildDialog(event, report, (i) => void pick(i));

      async function pick(i: number) {
        if (chosen) return;
        chosen = true;
        layer.classList.add('is-chosen');
        for (const b of buttons) {
          const me = b.dataset.choice === String(i);
          b.classList.add(me ? 'is-picked' : 'is-dim');
          b.setAttribute('aria-disabled', 'true');
          if (me) b.setAttribute('aria-pressed', 'true');
        }
        await wait(reducedMotion() ? 120 : T_CHOSEN);
        let result: ChoiceResult | undefined;
        store.dispatch((s) => {
          const r = applyChoice(s, data, eventId, i);
          result = r.result;
          return r.state;
        });
        layer.classList.add('is-leaving');
        await wait(T_LEAVE);
        layer.remove();
        document.removeEventListener('keydown', onKey);
        open = false;
        returnFocus?.focus?.({ preventScroll: true });
        if (result) {
          await feedback(result);
          resolve(result);
        }
      }

      // Клавиши слушает документ: клик мимо окна не должен отнимать у игрока цифры и Tab
      function onKey(e: KeyboardEvent) {
        if (chosen) {
          if (e.key === 'Tab') e.preventDefault();
          return;
        }
        if (e.key === 'Tab') {
          // Фокус не уходит из окна: Tab ходит по вариантам по кругу.
          e.preventDefault();
          const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next = (at + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
          buttons[at < 0 ? 0 : next]?.focus();
          return;
        }
        const digit = Number(e.key);
        if (Number.isInteger(digit) && digit >= 1 && digit <= buttons.length) {
          const b = buttons[digit - 1];
          if (b && b.getAttribute('aria-disabled') !== 'true') {
            e.preventDefault();
            b.focus();
            b.click();
          }
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const step = e.key === 'ArrowDown' ? 1 : -1;
          buttons[(at + step + buttons.length) % buttons.length]?.focus();
        }
      }
      document.addEventListener('keydown', onKey);

      root.append(layer);
      const first = buttons.find((b) => b.getAttribute('aria-disabled') !== 'true') ?? buttons[0];
      (first ?? dialog).focus({ preventScroll: true });
    });
  }

  async function showMorning(eventIds: string[], report?: MorningReport): Promise<ChoiceResult[]> {
    const results: ChoiceResult[] = [];
    const ids = eventIds.slice(0, data.balance.events.maxWindowsPerMorning);
    for (const [k, id] of ids.entries()) results.push(await show(id, k === 0 ? report : undefined));
    return results;
  }

  return {
    show,
    showMorning,
    get isOpen() {
      return open;
    },
  };
}
