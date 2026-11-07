// Разметка башни: детали модели (tower-model.ts) → div с классами .tw .* из sedmaya.css.
// Обновляет только изменившиеся элементы: группа и деталь находятся по ключу, класс, стиль
// и подпись переписываются, лишь когда отличаются. Анимации CSS при этом не перезапускаются.
// Появление нового яруса, падение сброшенного и сдвиг Шпиля — Web Animations на группе.
import {
  LAYERS,
  type Layer,
  MIST_LAYERS,
  partStyle,
  type SlotRect,
  TOWER_NAMES,
  type TowerModel,
} from './tower-model';

interface PartNode {
  el: HTMLDivElement;
  c: string;
  s: string;
  t: string;
}

interface GroupNode {
  el: HTMLDivElement;
  layer: Layer;
  tier: number | null;
  anchorY: number;
  parts: Map<string, PartNode>;
}

const BOX = 'position:absolute;left:0;top:0;width:0;height:0;overflow:visible;';
export const APPEAR_MS = 550;
export const SHIFT_MS = 500;
export const FALL_MS = 1100;

/** Клик по месту здания: ярус, слот и сама кнопка (к ней привязывается меню). */
export type SlotHandler = (tier: number, slot: number, el: HTMLElement) => void;

const TIER_WORDS: Record<string, string> = { root: 'Корень', spire: 'Шпиль' };

export interface ApplyStats {
  created: number;
  updated: number;
  removed: number;
}

export class TowerDom {
  readonly root: HTMLDivElement;
  private layers = new Map<Layer, HTMLDivElement>();
  private groups = new Map<string, GroupNode>();
  private gap = Number.NaN;
  private tilt = Number.NaN;
  /** Кнопки поверх мест зданий: клик открывает меню стройки (ТЗ 9, «Центр»). */
  private hitLayer: HTMLDivElement;
  private hits = new Map<string, HTMLButtonElement>();
  private onSlot: SlotHandler | null = null;
  private selected: string | null = null;

  constructor(private motion: () => boolean) {
    this.root = document.createElement('div');
    this.root.className = 'tw tw-game';
    this.root.setAttribute('role', 'img');
    this.root.style.cssText = BOX;
    for (const l of LAYERS) {
      const el = document.createElement('div');
      el.className = `tw-layer tw-${l}`;
      el.style.cssText = BOX;
      this.root.append(el);
      this.layers.set(l, el);
    }
    this.hitLayer = document.createElement('div');
    this.hitLayer.className = 'tw-hits';
    this.hitLayer.style.cssText = `${BOX}z-index:1;`;
    this.layers.get('tower')?.append(this.hitLayer);
  }

  /** Включить клики по слотам; null — выключить (окно события, ночь). */
  setSlotHandler(handler: SlotHandler | null): void {
    this.onSlot = handler;
    this.hitLayer.classList.toggle('is-off', !handler);
    for (const b of this.hits.values()) b.disabled = !handler;
  }

  /** Подсветить выбранный слот рамкой; null — снять. */
  select(tier: number | null, slot = 0): void {
    this.selected = tier == null ? null : `${tier}:${slot}`;
    for (const [k, b] of this.hits) {
      b.classList.toggle('is-selected', k === this.selected);
      b.setAttribute('aria-expanded', String(k === this.selected));
    }
  }

  /** Кнопка слота — чтобы поставить меню рядом. */
  slotElement(tier: number, slot: number): HTMLElement | null {
    return this.hits.get(`${tier}:${slot}`) ?? null;
  }

  private applyHits(slots: SlotRect[]): void {
    const keep = new Set<string>();
    let k = 0;
    const tierNo = new Map<number, number>();
    for (const r of slots) {
      const key = `${r.tier}:${r.slot}`;
      keep.add(key);
      let b = this.hits.get(key);
      if (!b) {
        b = document.createElement('button');
        b.type = 'button';
        b.className = 'tw-hit';
        b.disabled = !this.onSlot;
        const btn = b;
        b.addEventListener('click', () => this.onSlot?.(r.tier, Number(btn.dataset.slot), btn));
        this.hits.set(key, b);
        this.hitLayer.append(b);
      }
      b.dataset.tier = String(r.tier);
      b.dataset.slot = String(r.slot);
      if (r.kind === 'tier' && !tierNo.has(r.tier)) tierNo.set(r.tier, ++k);
      const tierName = TIER_WORDS[r.kind] ?? `Ярус ${tierNo.get(r.tier) ?? ''}`;
      const what = r.b ? (TOWER_NAMES[r.b] ?? r.b) : 'пусто, построить';
      b.setAttribute('aria-label', `${tierName}, слот ${r.slot + 1}: ${what}`);
      b.classList.toggle('is-empty', !r.b);
      b.classList.toggle('is-selected', key === this.selected);
      b.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;`;
    }
    for (const [key, b] of this.hits) {
      if (keep.has(key)) continue;
      b.remove();
      this.hits.delete(key);
    }
  }

  /** Перенести модель в разметку. animate = false — первый кадр: без появления и сдвигов. */
  apply(model: TowerModel, animate: boolean): ApplyStats {
    const stats: ApplyStats = { created: 0, updated: 0, removed: 0 };
    const anim = animate && this.motion();
    const seen = new Set<string>();

    model.groups.forEach((g, gi) => {
      seen.add(g.id);
      let node = this.groups.get(g.id);
      if (!node) {
        const el = document.createElement('div');
        el.className = 'tw-group';
        el.dataset.group = g.id;
        el.style.cssText = BOX;
        node = { el, layer: g.layer, tier: g.tier, anchorY: g.anchorY, parts: new Map() };
        this.groups.set(g.id, node);
        // Вставить перед следующей уже существующей группой того же слоя — порядок = глубина
        const layerEl = this.layers.get(g.layer) as HTMLDivElement;
        let before: Element | null = null;
        for (let j = gi + 1; j < model.groups.length && !before; j++) {
          const next = model.groups[j];
          const nn = next && next.layer === g.layer ? this.groups.get(next.id) : undefined;
          if (nn && nn.el.parentElement === layerEl) before = nn.el;
        }
        layerEl.insertBefore(el, before);
        if (anim && g.tier != null) {
          el.animate(
            [
              { opacity: 0, transform: 'translateY(48px) scaleY(.92)' },
              { opacity: 1, transform: 'none' },
            ],
            { duration: APPEAR_MS, easing: 'cubic-bezier(.2,.8,.3,1)' },
          );
        }
      } else if (g.anchorY !== node.anchorY) {
        // Ярус сместился (под ним вырос новый или ушёл нижний): доехать на новое место
        if (anim) {
          node.el.animate(
            [{ transform: `translateY(${node.anchorY - g.anchorY}px)` }, { transform: 'none' }],
            {
              duration: SHIFT_MS,
              easing: 'ease-in-out',
            },
          );
        }
        node.anchorY = g.anchorY;
      }
      node.tier = g.tier;

      const keep = new Set<string>();
      let prev: PartNode | null = null;
      for (const p of g.parts) {
        keep.add(p.k);
        const s = partStyle(p);
        let pn = node.parts.get(p.k);
        if (!pn) {
          const el = document.createElement('div');
          el.className = `p ${p.c}`;
          el.style.cssText = s;
          if (p.t) el.textContent = p.t;
          pn = { el, c: p.c, s, t: p.t };
          node.parts.set(p.k, pn);
          node.el.insertBefore(el, prev ? prev.el.nextSibling : node.el.firstChild);
          stats.created++;
        } else if (pn.c !== p.c || pn.s !== s || pn.t !== p.t) {
          if (pn.c !== p.c) pn.el.className = `p ${p.c}`;
          if (pn.s !== s) pn.el.style.cssText = s;
          if (pn.t !== p.t) pn.el.textContent = p.t;
          pn.c = p.c;
          pn.s = s;
          pn.t = p.t;
          stats.updated++;
        }
        prev = pn;
      }
      for (const [k, pn] of node.parts) {
        if (keep.has(k)) continue;
        pn.el.remove();
        node.parts.delete(k);
        stats.removed++;
      }
    });

    for (const [id, node] of this.groups) {
      if (seen.has(id)) continue;
      this.groups.delete(id);
      stats.removed += node.parts.size;
      if (anim && node.tier != null) {
        // Ярус отваливается и падает в Мглу
        const a = node.el.animate(
          [
            { opacity: 1, transform: 'none' },
            { opacity: 0.9, transform: 'translateY(60px) rotate(2deg)', offset: 0.3 },
            { opacity: 0, transform: 'translateY(720px) rotate(7deg)' },
          ],
          { duration: FALL_MS, easing: 'cubic-bezier(.5,0,.9,.6)' },
        );
        a.onfinish = () => node.el.remove();
      } else node.el.remove();
    }

    this.applyHits(model.slots);

    if (model.gapPx !== this.gap) {
      this.gap = model.gapPx;
      for (const l of MIST_LAYERS) {
        const el = this.layers.get(l);
        if (el) el.style.transform = `translateY(${model.gapPx}px)`;
      }
    }
    if (model.tilt !== this.tilt) {
      this.tilt = model.tilt;
      const el = this.layers.get('tower');
      if (el) el.style.transform = model.tilt ? `rotate(${model.tilt}deg)` : '';
    }
    return stats;
  }

  /** Число деталей в разметке — для отладки и проверки, что лишнего не осталось. */
  count(): number {
    let n = 0;
    for (const g of this.groups.values()) n += g.parts.size;
    return n;
  }
}
