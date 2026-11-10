// Окно «Заглянуть внутрь»: комната в разрезе и обход Председателя.
// Порядок: меню слота (build-menu) → open(ярус, слот, кнопка слота) → камера башни наезжает на слот
// (opts.focus), карточка вылетает из прямоугольника слота, фасад уезжает вверх и открывает сцену
// (room-model → div-ы .tw .rm). Под сценой — люди, выработка за ночь с причинами (roomInfo из core,
// тот же расчёт, что ночью), настроение и голос жителя. «Зайти к людям» — visitRoom через GameLoop.act:
// раз в день, эффект сразу (числа над плитками HUD), ответ жителя, отметка «Вы зашли». Закрытие —
// Esc, ×, клик мимо, смена фазы; карточка улетает обратно в слот, камера возвращается.
import { type GameData, type RoomInfo, type RoomMood, roomInfo, visitReply, visitRoom } from '../core';
import type { GameLoop } from '../game/loop';
import type { GameStore } from '../game/store';
import { etherLevel, partStyle } from '../scenes/tower-model';
import type { StatusLine } from './feedback';
import { dispText, fmtNum, GENITIVE, h, sgn, tierName } from './format';
import { buildRoom, ROOM_W, roomInputFromInfo, roomWall } from './room-model';
import './room.css';

export interface RoomViewOptions {
  store: GameStore;
  data: GameData;
  loop: GameLoop;
  status: StatusLine;
  flash(key: string, delta: number): void;
  /** Камера башни: наехать на слот; null — вернуть общий план. */
  focus(tier: number | null, slot?: number): void;
  /** Кнопка слота на башне: из неё вылетает окно и в неё возвращается. */
  slotElement(tier: number, slot: number): HTMLElement | null;
}

export interface RoomView {
  open(tier: number, slot: number, anchor?: HTMLElement | null): void;
  close(): void;
  readonly isOpen: boolean;
}

const STAGES = ['Времянка', 'Мастерская', 'Эфирная'];
const BAD: ReadonlySet<RoomMood> = new Set([
  'mist',
  'frost',
  'dark',
  'hungry',
  'sick',
  'unrest',
  'rumors',
  'quarrel',
  'empty',
  'short',
  'crowded',
]);
const REASON: Record<string, string> = {
  staff: 'рабочих',
  mist: 'Мгла на ярусе',
  decree: 'декрет',
  root: 'в Корне',
  institute: 'Институт враждует',
};
const TICK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5"/></svg>';
// Длительности интерфейса, мс (не баланс): полёт карточки, «заходим…», приветствие в сцене
const T_FLY = 260;
const T_CLOSE = 200;
const T_BUSY = 320;
const T_GREET = 1100;

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const factorText = (f: number) => `×${fmtNum(Math.round(f * 100) / 100)}`;

function effectsLine(e: Record<string, number>): string {
  const parts = Object.entries(e)
    .filter(([, v]) => v)
    .map(([k, v]) => `${sgn(v)} ${GENITIVE[k] ?? k}`);
  return parts.length ? parts.join(', ') : 'ничего';
}

export function mountRoomView(root: HTMLElement, opts: RoomViewOptions): RoomView {
  const { store, data, loop, status } = opts;
  const layer = h('div', { class: 'room-layer', hidden: true });
  const backdrop = h('div', { class: 'room-backdrop' });
  const card = h('section', { class: 'paper room', role: 'dialog', 'aria-modal': 'true', tabindex: '-1' });
  layer.append(backdrop, card);
  root.append(layer);

  let at: { tier: number; slot: number; anchor: HTMLElement | null } | null = null;
  /** Свежий результат обхода: показать отметку с анимацией один раз. */
  let justVisited = false;
  let busy = false;
  let leaving = 0;
  let ro: ResizeObserver | null = null;

  function anchorRect(): DOMRect | null {
    if (!at) return null;
    const el = opts.slotElement(at.tier, at.slot) ?? at.anchor;
    const r = el?.getBoundingClientRect();
    return r && r.width > 0 ? r : null;
  }

  /** Сдвиг и масштаб, при которых карточка совпадает с прямоугольником слота. */
  function flyFrom(r: DOMRect): string {
    const c = card.getBoundingClientRect();
    const sx = Math.max(0.05, r.width / c.width);
    const sy = Math.max(0.05, r.height / c.height);
    return `translate(${r.left - c.left}px, ${r.top - c.top}px) scale(${sx}, ${sy})`;
  }

  function scene(info: RoomInfo): HTMLElement {
    const s = store.state;
    const model = buildRoom(roomInputFromInfo(info, s, etherLevel(s, data.balance)));
    const tw = h('div', { class: 'tw rm', 'aria-hidden': 'true' });
    for (const p of model.parts) {
      const d = document.createElement('div');
      d.className = `p ${p.c}`;
      d.setAttribute('style', partStyle(p));
      if (p.t) d.textContent = p.t;
      tw.append(d);
    }
    return tw;
  }

  function peopleText(info: RoomInfo): HTMLElement {
    if (info.abandoned) return h('dd', {}, 'Никого: ярус заброшен');
    if (info.residents)
      return h('dd', { class: 'num' }, `Живут ${info.residents.live} из ${info.residents.places}`);
    if (info.workers) {
      const { have, need } = info.workers;
      return h(
        'dd',
        { class: 'num' },
        `Работают ${have} из ${need}`,
        have < need
          ? h('span', { class: 'room-why' }, 'Свободных рук не осталось: жители заняты в зданиях ниже')
          : null,
      );
    }
    if (info.id === 'core') return h('dd', {}, 'Вахта кочегаров у топки');
    if (info.id === 'council') return h('dd', {}, 'Совет заседает');
    return h('dd', {}, '—');
  }

  function outputText(info: RoomInfo): HTMLElement {
    const def = data.balance.buildings[info.id];
    if (info.output) {
      const why = info.output.reasons.map((r) => {
        const text =
          r.kind === 'staff' && info.workers
            ? `${REASON.staff} ${info.workers.have} из ${info.workers.need} ${factorText(r.factor)}`
            : `${REASON[r.kind] ?? r.kind} ${factorText(r.factor)}`;
        return h('span', { class: r.factor < 1 ? 'bad' : undefined }, text);
      });
      // Причины — только когда здание даёт не свою норму
      const parts: (Node | string)[] = [`норма ${effectsLine(info.output.base as Record<string, number>)}`];
      for (const w of why) parts.push(' · ', w);
      return h(
        'dd',
        { class: 'num' },
        h('b', {}, effectsLine(info.output.effects)),
        why.length ? h('span', { class: 'room-why' }, ...parts) : null,
      );
    }
    if (def?.housing) return h('dd', {}, `Жильё на ${def.housing} человек`);
    if (info.id === 'core') return h('dd', {}, 'Держит башню в воздухе: эфир сгорает здесь каждую ночь');
    if (info.id === 'council') return h('dd', {}, 'Отсюда выходят декреты');
    return h('dd', {}, 'Своей выработки нет');
  }

  function visitRow(info: RoomInfo): HTMLElement {
    const row = h('div', { class: 'room-visit' });
    const gain = effectsLine(info.visit.effects as Record<string, number>);
    if (info.visit.here) {
      const done = h(
        'span',
        { class: `room-visit-done${justVisited ? ' is-new' : ''}`, role: 'status' },
        h('span', { 'aria-hidden': 'true' }),
        `Вы зашли к людям: ${gain}`,
      );
      (done.firstChild as HTMLElement).innerHTML = TICK;
      row.append(done);
      justVisited = false;
      return row;
    }
    const btn = h(
      'button',
      {
        type: 'button',
        class: 'btn small room-go',
        'aria-disabled': info.visit.blocker ? 'true' : undefined,
      },
      `Зайти к людям · ${gain}`,
    );
    const note = h(
      'span',
      { class: 'room-visit-note', 'aria-live': 'polite' },
      info.visit.blocker ?? 'Обход — раз в день, в одну комнату',
    );
    if (info.visit.blocker) btn.setAttribute('disabled', '');
    btn.addEventListener('click', () => void visit(btn, note));
    row.append(btn, note);
    return row;
  }

  async function visit(btn: HTMLButtonElement, note: HTMLElement) {
    if (!at || busy) return;
    const { tier, slot } = at;
    busy = true;
    btn.setAttribute('aria-busy', 'true');
    btn.textContent = 'Идём к людям…';
    if (!reducedMotion()) await new Promise((r) => window.setTimeout(r, T_BUSY));
    const before = store.state;
    const r = loop.act((s) => visitRoom(s, data, tier, slot));
    busy = false;
    if (!r.ok) {
      btn.removeAttribute('aria-busy');
      btn.textContent = 'Попробовать ещё раз';
      note.textContent = r.reason;
      status.say(r.reason, 'bad');
      return;
    }
    const id = before.tiers[tier]?.slots[slot] ?? '';
    // Числа над плитками HUD — настоящее изменение (показатель у потолка 100 может не вырасти)
    for (const k of Object.keys(data.balance.rooms.visit[id] ?? {})) {
      const d =
        k in before.res
          ? r.state.res[k as keyof typeof before.res] - before.res[k as keyof typeof before.res]
          : r.state.stats[k as keyof typeof before.stats] - before.stats[k as keyof typeof before.stats];
      if (d) opts.flash(k, d);
    }
    justVisited = true;
    reply = visitReply(data, id);
    render();
    const rm = card.querySelector('.rm');
    rm?.classList.add('is-greeting');
    window.setTimeout(() => rm?.classList.remove('is-greeting'), T_GREET);
  }

  /** Ответ на обход заменяет голос комнаты до закрытия окна. */
  let reply: { who: string; text: string } | null = null;

  function render() {
    if (!at) return;
    const s = store.state;
    const info = roomInfo(s, data, at.tier, at.slot);
    if (!info) {
      close();
      return;
    }
    const kinds = s.tiers.map((t) => t.kind);
    const place = `${tierName(kinds, at.tier)} · слот ${at.slot + 1}`;
    const closeBtn = h('button', { type: 'button', class: 'room-close', 'aria-label': 'Закрыть' }, '×');
    closeBtn.addEventListener('click', () => close());
    const title = h('h2', { class: 'disp room-title', id: 'room-title' }, dispText(info.name));
    const head = h(
      'div',
      { class: 'room-head' },
      h('span', { class: 'plaque ink' }, place),
      title,
      h('span', { class: 'lbl' }, `${STAGES[info.stage - 1] ?? ''} · взгляд изнутри`),
    );

    const stage = h('div', { class: 'room-stage' }, scene(info));
    const facade = h('div', { class: 'room-facade', 'aria-hidden': 'true' }, h('span', {}, info.name));
    facade.style.setProperty('--fc', roomWall(info.id));
    stage.append(facade);

    const moods = h(
      'dd',
      { class: 'room-moods' },
      ...info.moods.map((m) =>
        h(
          'span',
          {
            class: `room-mood${BAD.has(m) ? ' is-bad' : m === 'festive' ? ' is-good' : ''}`,
            title: data.rooms.moods[m]?.hint,
          },
          data.rooms.moods[m]?.label ?? m,
        ),
      ),
    );
    const facts = h(
      'dl',
      { class: 'room-facts' },
      h('dt', {}, 'Люди'),
      peopleText(info),
      h('dt', {}, 'За ночь'),
      outputText(info),
      h('dt', {}, 'Внутри'),
      moods,
    );
    const said = reply ?? info.line;
    const voice = said
      ? h(
          'blockquote',
          { class: `room-voice${reply ? ' is-new' : ''}` },
          `«${said.text}»`,
          h('cite', {}, said.who),
        )
      : null;

    const prev = card.querySelector('.room-stage');
    card.replaceChildren(
      h('div', { class: 'room-top' }, head, closeBtn),
      stage,
      facts,
      voice ?? '',
      visitRow(info),
    );
    card.setAttribute('aria-labelledby', 'room-title');
    // Повторная отрисовка (после обхода) — фасад уже открыт, сцена на месте
    if (prev) facade.remove();
    ro?.disconnect();
    ro = new ResizeObserver(() => fitStage(stage));
    ro.observe(stage);
    fitStage(stage);
  }

  function fitStage(stage: HTMLElement) {
    const k = stage.clientWidth / ROOM_W;
    stage.querySelector<HTMLElement>('.rm')?.style.setProperty('--k', String(k || 1));
  }

  function open(tier: number, slot: number, anchor: HTMLElement | null = null) {
    if (loop.phase !== 'day') return;
    if (!roomInfo(store.state, data, tier, slot)) return;
    window.clearTimeout(leaving);
    at = { tier, slot, anchor };
    reply = null;
    justVisited = false;
    layer.hidden = false;
    layer.classList.remove('is-open', 'is-leaving');
    card.classList.remove('is-flying', 'is-closing');
    card.style.transform = '';
    card.style.opacity = '';
    render();
    opts.focus(tier, slot);
    const r = anchorRect();
    if (r && !reducedMotion()) {
      card.style.transform = flyFrom(r);
      card.style.opacity = '0.4';
      void card.offsetWidth;
      card.classList.add('is-flying');
      card.style.transform = '';
      card.style.opacity = '';
      window.setTimeout(() => card.classList.remove('is-flying'), T_FLY);
    }
    // Переходы стартуют от начального кадра: reflow, затем класс (без rAF — он спит в фоновой вкладке)
    void layer.offsetWidth;
    layer.classList.add('is-open');
    card.querySelector<HTMLElement>('.room-go:not([disabled]), .room-close')?.focus({ preventScroll: true });
  }

  function close() {
    if (!at) return;
    const r = anchorRect();
    const anchor = opts.slotElement(at.tier, at.slot) ?? at.anchor;
    at = null;
    busy = false;
    ro?.disconnect();
    ro = null;
    opts.focus(null);
    layer.classList.remove('is-open');
    layer.classList.add('is-leaving');
    const done = () => {
      layer.hidden = true;
      layer.classList.remove('is-leaving');
      card.classList.remove('is-closing');
      card.style.transform = '';
      card.style.opacity = '';
      card.replaceChildren();
    };
    if (r && !reducedMotion()) {
      card.classList.add('is-closing');
      card.style.transform = flyFrom(r);
      card.style.opacity = '0';
      leaving = window.setTimeout(done, T_CLOSE);
    } else done();
    anchor?.focus({ preventScroll: true });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && at) {
      e.stopPropagation();
      close();
    }
  });
  backdrop.addEventListener('click', () => close());
  loop.onPhase((p) => {
    if (p !== 'day') close();
  });
  store.subscribe(() => {
    if (at && !busy) render();
  });

  return {
    open,
    close,
    get isOpen() {
      return at !== null;
    },
  };
}
