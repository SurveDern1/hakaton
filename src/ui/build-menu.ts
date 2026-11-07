// Меню стройки по Main.dc.html: клик по слоту башни → бумажная карточка рядом со слотом.
// Пустой слот — здания с ценой и причиной запрета (buildBlocker); здание — описание и снос;
// обычный ярус — «Сбросить ярус» с подтверждением и числом жертв (dropTierVictims).
// Действия идут через GameLoop.act; результат — строка статуса и числа над плитками.
import {
  type BuildingDef,
  build,
  buildBlocker,
  demolish,
  dropTier,
  dropTierVictims,
  freeWorkers,
  type GameData,
  type GameState,
} from '../core';
import type { GameLoop } from '../game/loop';
import type { GameStore } from '../game/store';
import type { StatusLine } from './feedback';
import { buildingText, h, plural, tierName } from './format';

export interface BuildMenuOptions {
  store: GameStore;
  data: GameData;
  loop: GameLoop;
  status: StatusLine;
  flash(key: string, delta: number): void;
  /** Подсветка выбранного слота на башне. */
  select(tier: number | null, slot?: number): void;
}

export interface BuildMenu {
  open(tier: number, slot: number, anchor: HTMLElement): void;
  close(): void;
  readonly isOpen: boolean;
}

/** Здания, которые вообще можно предложить: не встроенные, не после MVP, открытые. */
const HIDE = new Set(['Это здание не строится', 'Ещё не открыто', 'Не подходит для этого яруса']);

export function mountBuildMenu(root: HTMLElement, opts: BuildMenuOptions): BuildMenu {
  const { store, data, loop, status } = opts;
  const b = data.balance;
  const card = h('div', { class: 'paper bmenu', role: 'dialog', 'aria-modal': 'false', hidden: true });
  root.append(card);
  let at: { tier: number; slot: number; anchor: HTMLElement } | null = null;
  let confirmDrop = false;

  function close() {
    if (!at) return;
    const anchor = at.anchor;
    at = null;
    confirmDrop = false;
    card.hidden = true;
    card.classList.remove('is-in');
    opts.select(null);
    if (document.activeElement && card.contains(document.activeElement))
      anchor.focus({ preventScroll: true });
  }

  function act(
    fn: (s: GameState) => ReturnType<typeof build>,
    ok: (before: GameState, after: GameState) => string,
  ) {
    const before = store.state;
    const r = loop.act(fn);
    if (!r.ok) {
      status.say(r.reason, 'bad');
      render();
      return;
    }
    status.say(ok(before, r.state));
    for (const k of ['pop', 'mat'] as const) {
      const d = r.state.res[k] - before.res[k];
      if (d) opts.flash(k, d);
    }
    const sd = r.state.stats.solidarity - before.stats.solidarity;
    if (sd) opts.flash('solidarity', sd);
    close();
  }

  function option(id: string, def: BuildingDef, s: GameState, tier: number, slot: number): HTMLElement {
    const why = buildBlocker(s, data, tier, slot, id);
    const btn = h(
      'button',
      { type: 'button', class: 'bm-opt', 'aria-disabled': why ? 'true' : undefined },
      h('span', { class: 'bm-name' }, def.name),
      h('span', { class: 'num bm-cost' }, `${def.cost ?? 0} мат.`),
      h('span', { class: 'bm-desc' }, why ?? buildingText(def)),
    );
    btn.addEventListener('click', () => {
      if (why) {
        status.say(why, 'bad');
        return;
      }
      act(
        (st) => build(st, data, tier, slot, id),
        () => `Построено: ${def.name} · −${def.cost ?? 0} мат.`,
      );
    });
    return btn;
  }

  function render() {
    if (!at) return;
    const s = store.state;
    const { tier, slot } = at;
    const t = s.tiers[tier];
    if (!t) {
      close();
      return;
    }
    const kinds = s.tiers.map((x) => x.kind);
    const name = tierName(kinds, tier);
    const id = t.slots[slot] ?? null;
    const head = h(
      'div',
      { class: 'bm-head' },
      h('span', { class: 'plaque ink' }, `${name} · слот ${slot + 1}`),
      h('span', { class: 'num bm-free' }, `свободных рук ${freeWorkers(s, b)}`),
    );
    const closeBtn = h('button', { type: 'button', class: 'bm-close', 'aria-label': 'Закрыть' }, '×');
    closeBtn.addEventListener('click', close);
    const body: HTMLElement[] = [];

    if (t.abandoned) {
      body.push(
        h(
          'p',
          { class: 'bm-note' },
          'Ярус заброшен: Мгла держала его слишком долго. Здесь больше никто не живёт.',
        ),
      );
    } else if (!id) {
      const opts2 = Object.entries(b.buildings)
        .filter(([bid]) => !HIDE.has(buildBlocker(s, data, tier, slot, bid) ?? ''))
        .map(([bid, def]) => option(bid, def, s, tier, slot));
      body.push(...(opts2.length ? opts2 : [h('p', { class: 'bm-note' }, 'Сюда ничего не поставить.')]));
    } else {
      const def = b.buildings[id];
      const refund = Math.floor((def?.cost ?? 0) * b.demolishRefund);
      body.push(
        h(
          'div',
          { class: 'bm-built' },
          h('span', { class: 'bm-name' }, def?.name ?? id),
          h('span', { class: 'bm-desc' }, def ? buildingText(def) : ''),
        ),
      );
      if (def?.fixed) body.push(h('p', { class: 'bm-note' }, 'Встроено в башню, не сносится.'));
      else {
        const del = h(
          'button',
          { type: 'button', class: 'btn ink small bm-act' },
          `Снести · +${refund} мат.`,
        );
        del.addEventListener('click', () =>
          act(
            (st) => demolish(st, data, tier, slot),
            () => `Снесено: ${def?.name ?? id} · +${refund} мат.`,
          ),
        );
        body.push(del);
      }
    }

    if (t.kind === 'tier') {
      const victims = dropTierVictims(s, data, tier);
      if (!confirmDrop) {
        const drop = h('button', { type: 'button', class: 'bm-drop' }, 'Сбросить ярус…');
        drop.addEventListener('click', () => {
          confirmDrop = true;
          render();
          card.querySelector<HTMLElement>('.bm-confirm .btn')?.focus();
        });
        body.push(drop);
      } else {
        const sol = victims > 0 ? ` Солидарность ${b.tower.dropTier.solidarityPerTierWithPeople}.` : '';
        const yes = h('button', { type: 'button', class: 'btn small' }, 'Сбросить');
        const no = h('button', { type: 'button', class: 'btn ink small' }, 'Отмена');
        yes.addEventListener('click', () =>
          act(
            (st) => dropTier(st, data, tier),
            () =>
              victims
                ? `${name} сброшен. Погибли ${victims} ${plural(victims, 'человек', 'человека', 'человек')}`
                : `${name} сброшен, людей там не было`,
          ),
        );
        no.addEventListener('click', () => {
          confirmDrop = false;
          render();
        });
        body.push(
          h(
            'div',
            { class: 'bm-confirm', role: 'alert' },
            h(
              'p',
              {},
              victims
                ? `Вместе с ярусом упадут ${victims} ${plural(victims, 'житель', 'жителя', 'жителей')}.${sol} На башне останется шрам.`
                : `Ярус пуст: людей не будет. На башне останется шрам.`,
            ),
            h('div', { class: 'bm-row' }, yes, no),
          ),
        );
      }
    }

    card.replaceChildren(h('div', { class: 'bm-top' }, head, closeBtn), ...body);
    card.setAttribute('aria-label', `${name}, слот ${slot + 1}`);
    place();
  }

  function place() {
    if (!at) return;
    const r = at.anchor.getBoundingClientRect();
    // Меню живёт в рамке телефона #app: размеры и координаты — от неё, а не от окна
    const frame = (document.getElementById('app') ?? document.body).getBoundingClientRect();
    const vw = frame.width;
    const vh = frame.height;
    if (vw < 760) {
      card.style.left = '';
      card.style.top = '';
      card.classList.add('is-sheet');
      return;
    }
    card.classList.remove('is-sheet');
    const w = card.offsetWidth || 260;
    const hgt = card.offsetHeight || 300;
    let left = r.right - frame.left + 24;
    if (left + w > vw - 420) left = Math.max(12, r.left - frame.left - w - 24);
    const top = Math.min(Math.max(112, r.top - frame.top + r.height / 2 - hgt / 2), vh - hgt - 12);
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }

  // Меню закрывается по Esc, клику мимо и любой смене фазы (ночь, окно события)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && at) close();
  });
  document.addEventListener('pointerdown', (e) => {
    const t = e.target as HTMLElement;
    if (at && !card.contains(t) && !t.closest('.tw-hit')) close();
  });
  loop.onPhase((p) => {
    if (p !== 'day') close();
  });
  store.subscribe(() => render());

  return {
    open(tier, slot, anchor) {
      if (loop.phase !== 'day') return;
      if (at && at.tier === tier && at.slot === slot) {
        close();
        return;
      }
      at = { tier, slot, anchor };
      confirmDrop = false;
      card.hidden = false;
      opts.select(tier, slot);
      render();
      card.classList.remove('is-in');
      void card.offsetWidth;
      card.classList.add('is-in');
      card
        .querySelector<HTMLElement>('.bm-opt:not([aria-disabled]), .bm-act, .bm-close')
        ?.focus({ preventScroll: true });
    },
    close,
    get isOpen() {
      return at !== null;
    },
  };
}
