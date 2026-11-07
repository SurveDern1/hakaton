// Модель изображения башни: состояние → список деталей. Перенос renderTower из
// design/project/Tower.dc.html (ТЗ §7.2–7.4) в чистый TypeScript без Phaser и DOM.
// Каждая деталь — {класс .tw .*, прямоугольник, доп. стиль, подпись}; вид деталей задан
// в design/project/sedmaya.css, поэтому игра и макет рисуются одними и теми же правилами.
//
// Отличия от макета, нужные игре:
// - координаты локальные: x = 0 по оси башни, y = 0 на днище Корня (слои башни) или на уровне
//   Мглы (слои Мглы). Высота и Мгла двигают только слои Мглы — башня не перерисовывается;
// - детали собраны в группы (каркас, двигатель, каждый ярус, Шпиль…) с ключами, чтобы сцена
//   обновляла только изменившиеся элементы и анимировала появление и уход ярусов;
// - случайность окон и одежды берётся от группы, а не от сквозного номера: новый ярус не
//   перекрашивает остальные.
// Числа здесь — геометрия картинки (пиксели макета), а не баланс игры.
import type { Balance, GameState, Stats, TierKind } from '../core';

export const TOWER_K = 12.5;
const U = TOWER_K / 5;
const GEOM = { wid: { root: 525, tier: 475, spire: 375 }, over: 24, truss: 14, deck: 12 } as const;
const ALIAS: Record<string, string> = { salvage: 'scrap', red_corner: 'corner' };
const FIXED: Record<string, boolean> = { core: true, council: true };
const TINTS = ['#634734', '#486467', '#715441', '#174D5A', '#574336'];
const CLOTH = ['#9A3335', '#255D6B', '#A26943', '#255D6B', '#255D6B', '#AE5700'];
/** Запас эфира на столько ночей считается полным: ядро светит в полную силу. */
export const ETHER_FULL_NIGHTS = 3;
/** Ширина Мглы и неба в обе стороны от оси: перекрывает экран при любом масштабе камеры. */
const MIST_HALF = 2600;
const MIST_DEPTH = 6000;

export const TOWER_NAMES: Record<string, string> = {
  core: 'Ядро',
  catcher: 'Уловитель',
  housing: 'Жилой',
  farm: 'Ферма',
  council: 'Совет',
  infirmary: 'Лазарет',
  guard: 'Стража',
  scrap: 'Разборка',
  radio: 'Радио',
  corner: 'Кр. уголок',
  observatory: 'Обсерватория',
};

export type SlotInput = string | { b: string; stage?: number } | null;

export interface TowerTierInput {
  kind: TierKind;
  slots: SlotInput[];
  abandoned?: boolean;
}

export interface TowerScars {
  /** [ярус, доля ширины, доля высоты] — трещина с заплатой. */
  patches?: [number, number, number][];
  stumpAt?: number | null;
  memorial?: boolean;
}

/** Всё, что нужно картинке. Формат совпадает с state у renderTower в макете. */
export interface TowerInput {
  altitude: number;
  mist: number;
  /** Эфир 0..1: яркость ядра, скорость пропеллеров, крен, сила подушки. */
  ether: number;
  stats: Stats;
  tiers: TowerTierInput[];
  scars?: TowerScars;
}

export type Layer = 'sky' | 'mistBack' | 'tower' | 'smoke' | 'mistFront' | 'over';
/** Слои в порядке отрисовки снизу вверх. Слои Мглы привязаны к её уровню, остальные — к днищу. */
export const LAYERS: readonly Layer[] = ['sky', 'mistBack', 'tower', 'smoke', 'mistFront', 'over'];
export const MIST_LAYERS: ReadonlySet<Layer> = new Set<Layer>(['mistBack', 'mistFront']);

export interface Part {
  /** Ключ внутри группы: основной класс и номер его появления. */
  k: string;
  /** Классы .tw .* без общего «p». */
  c: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Дополнительный стиль: прозрачность, длительность анимации, переменные. */
  s: string;
  t: string;
}

export interface Group {
  id: string;
  layer: Layer;
  /** Ярус группы (для анимации появления и падения), иначе null. */
  tier: number | null;
  /** Точка привязки по высоте: при её сдвиге сцена плавно доводит группу на новое место. */
  anchorY: number;
  parts: Part[];
}

export interface TowerModel {
  groups: Group[];
  /** Расстояние от днища до Мглы в пикселях: сдвиг слоёв Мглы. */
  gapPx: number;
  /** Крен башни в градусах (нехватка эфира). */
  tilt: number;
  /** Рамка для камеры в локальных координатах. */
  bounds: { x: number; y: number; w: number; h: number };
  /** Мгла у самого Корня: иней и клубы. */
  close: boolean;
  /** Подушка рвётся: эфира меньше половины. */
  cushionWeak: boolean;
  starMode: 'on' | 'blink' | 'off';
  /** Доля горящих окон от здоровья. */
  lit: number;
  /** Места зданий для кликов: ярус, слот и прямоугольник в координатах слоя башни. */
  slots: SlotRect[];
}

export interface SlotRect {
  tier: number;
  slot: number;
  kind: TierKind;
  /** Здание в слоте (id из данных) или null. */
  b: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Slot {
  b: string;
  stage: 1 | 2 | 3;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const r1 = (v: number) => Math.round(v * 10) / 10;
const op = (v: number) => `opacity:${v.toFixed(2)};`;

export function hash01(i: number): number {
  const x = Math.sin(i * 12.9898 + 4.1) * 43758.5453;
  return x - Math.floor(x);
}

function strSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 9973;
  return h;
}

/** Слот: строка 'farm' (стадия 1, у Ядра и Совета — 2) или {b, stage}; пусто — null. */
export function normalizeSlot(v: SlotInput | undefined): Slot | null {
  if (!v) return null;
  let b = typeof v === 'string' ? v : v.b;
  if (!b || b === 'empty') return null;
  b = ALIAS[b] ?? b;
  const st = (typeof v === 'object' && v.stage) || (FIXED[b] ? 2 : 1);
  return { b, stage: clamp(Math.round(st), 1, 3) as 1 | 2 | 3 };
}

/** Эфир 0..1 по запасу на ночи вперёд: запас / (расход за ночь × ETHER_FULL_NIGHTS). */
export function etherLevel(state: GameState, balance: Balance): number {
  const n = balance.engine.need;
  const need = n.base + n.perTier * state.tiers.length + n.perTenPop * Math.floor(state.res.pop / 10);
  if (need <= 0) return 1;
  return clamp(state.res.ether / (need * ETHER_FULL_NIGHTS), 0, 1);
}

/** Шрамы из ids в state.scars: каждый — заплата в своём месте; сброшенный ярус — обрубок и табличка. */
export function scarsFromIds(ids: readonly string[], tierCount: number): TowerScars | undefined {
  if (!ids.length) return undefined;
  const patches: [number, number, number][] = [];
  let dropped = false;
  ids.forEach((id, i) => {
    if (/drop|lost|stump/.test(id)) dropped = true;
    const s = strSeed(id) + i * 7;
    const ti = Math.floor(hash01(s) * Math.max(1, tierCount - 1));
    patches.push([ti, r1(0.1 + hash01(s + 1) * 0.75), r1(0.12 + hash01(s + 2) * 0.2)]);
  });
  return dropped ? { patches, stumpAt: Math.min(1, tierCount - 1), memorial: true } : { patches };
}

/** Состояние игры → вход картинки. Стадии зданий берутся из слота, если он объект {b, stage}. */
export function towerInputFromState(state: GameState, balance: Balance): TowerInput {
  return {
    altitude: state.altitude,
    mist: state.mist,
    ether: etherLevel(state, balance),
    stats: { ...state.stats },
    tiers: state.tiers.map((t) => ({
      kind: t.kind,
      slots: t.slots as SlotInput[],
      abandoned: t.abandoned,
    })),
    scars: scarsFromIds(state.scars, state.tiers.length),
  };
}

/** Плавный переход между двумя входами: числа интерполируются, состав ярусов берётся из целевого. */
export function lerpInput(a: TowerInput, b: TowerInput, t: number): TowerInput {
  const l = (x: number, y: number) => x + (y - x) * t;
  return {
    ...b,
    altitude: l(a.altitude, b.altitude),
    mist: l(a.mist, b.mist),
    ether: l(a.ether, b.ether),
    stats: {
      trust: l(a.stats.trust, b.stats.trust),
      solidarity: l(a.stats.solidarity, b.stats.solidarity),
      health: l(a.stats.health, b.stats.health),
      order: l(a.stats.order, b.stats.order),
    },
  };
}

/** Ключи групп ярусов: Корень, ярус1…ярусN, Шпиль — новый ярус не переименовывает соседей. */
export function tierGroupIds(tiers: readonly TowerTierInput[]): string[] {
  let k = 0;
  return tiers.map((t) => (t.kind === 'tier' ? `tier${++k}` : t.kind));
}

export function buildTower(s: TowerInput, opts: { labels?: boolean } = {}): TowerModel {
  const K = TOWER_K;
  const OV = GEOM.over;
  const st = s.stats;
  const e = clamp(Number.isFinite(s.ether) ? s.ether : 1, 0, 1);
  const sc = s.scars ?? {};
  const labels = !!opts.labels;
  const lit = clamp((st.health - 15) / 70, 0, 1);
  const lowOrder = st.order < 35;
  const lowSol = st.solidarity < 35;
  const lowHealth = st.health < 35;
  const lowTrust = st.trust < 35;
  const hiOrder = st.order >= 70;
  const hiSol = st.solidarity >= 70;
  const hiHealth = st.health >= 70;
  const hiTrust = st.trust >= 70;
  const tiers = s.tiers;
  const n = tiers.length;
  const ids = tierGroupIds(tiers);
  const A = s.altitude;
  const M = s.mist;
  const close = A - M < 10;
  const gapPx = r1((A - M) * K);

  const groups: Group[] = [];
  const slotRects: SlotRect[] = [];
  let g: Group = { id: '', layer: 'tower', tier: null, anchorY: 0, parts: [] };
  let counts = new Map<string, number>();
  let seed = 0;
  let winIdx = 0;
  let figIdx = 0;
  let groupLit = lit;
  let noPeople = false;

  function open(id: string, layer: Layer, tier: number | null = null, anchorY = 0): void {
    g = { id, layer, tier, anchorY, parts: [] };
    groups.push(g);
    counts = new Map();
    seed = strSeed(id) * 101;
    winIdx = 0;
    figIdx = 0;
    groupLit = lit;
    noPeople = false;
  }
  function px(c: string, x: number, y: number, w: number, h: number, extra = '', t = ''): void {
    const base = c.split(' ', 1)[0] ?? c;
    const nth = (counts.get(base) ?? 0) + 1;
    counts.set(base, nth);
    g.parts.push({ k: `${base}#${nth}`, c, x: r1(x), y: r1(y), w: r1(w), h: r1(h), s: extra, t });
  }
  // Тонкая деталь от точки к точке: трос, растяжка, верёвка
  function line(c: string, x1: number, y1: number, x2: number, y2: number, t: number): void {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    const a = (Math.atan2(dy, dx) * 180) / Math.PI;
    px(c, x1, y1 - t / 2, len, t, `transform:rotate(${a.toFixed(1)}deg);transform-origin:0 50%;`);
  }
  // Житель: силуэт 9×22 px (1,75 м); x — центр, yb — пол. При высокой солидарности одежда разноцветная
  function fig(x: number, yb: number, cls = '', extra = ''): void {
    if (noPeople) return;
    const i = figIdx++;
    const col = hiSol ? CLOTH[Math.floor(hash01(seed + i + 31) * CLOTH.length)] : '#1A3437';
    px(`man${cls ? ` ${cls}` : ''}`, x - 4.5, yb - 22, 9, 22, `--cc:${col};${extra}`);
  }
  function win(x: number, y: number, w: number, h: number, ti: number, S: number): void {
    const k = seed + winIdx++;
    const cls =
      `win w${S}` +
      (hash01(k) < groupLit ? ' on' : '') +
      (lowOrder && hash01(k + 97) > 0.58 ? ' broken' : '') +
      (ti === 0 && close ? ' frost' : '');
    px(cls, x, y, w, h);
  }
  const tw = (i: number) => {
    const t = tiers[i];
    return t ? GEOM.wid[t.kind] : GEOM.wid.tier;
  };
  // Высота в метрах над днищем → y. Днище Корня — 0, вверх — минус.
  const ym = (m: number) => r1((A - m) * K);

  // Здание в слоте: x, y — левый верх, w × h, низ стоит на палубе. Стадия меняет материал:
  // 1 — доски, брезент, верёвки; 2 — металл, заклёпки, трубы; 3 — латунь, кристаллы, бирюзовое свечение
  function building(sl: Slot | null, x: number, y: number, w: number, h: number, ti: number): void {
    const P = (c: string, rx: number, ry: number, rw: number, rh: number, ex = '', t = '') =>
      px(c, x + rx, y + ry, rw, rh, ex, t);
    const L = (c: string, ax: number, ay: number, bx: number, by: number, t: number) =>
      line(c, x + ax, y + ay, x + bx, y + by, t);
    if (!sl) {
      P('slot-empty', 0, 10, w, h - 10, '', '+');
      return;
    }
    const b = sl.b;
    const S = sl.stage;
    const sS = ` s${S}`;
    function shell(bc: string, rx: number, ry: number, rw: number, rh: number, noTop = false): void {
      P(`fac${sS}`, rx, ry, rw, rh, `--bc:${bc};`);
      if (S === 1) {
        if (!noTop) {
          P('tarp', rx - 4, ry - 9, rw + 8, 15);
          L('rope', rx - 3, ry - 1, rx + 7, ry + 20, 1.5);
          L('rope', rx + rw + 3, ry - 1, rx + rw - 7, ry + 20, 1.5);
        } else P('cap1', rx - 2, ry - 4, rw + 4, 5);
      } else if (S === 2) {
        P('cap2', rx - 3, ry - 6, rw + 6, 7);
      } else {
        P('cap3', rx - 3, ry - 7, rw + 6, 8);
        if (!noTop) {
          P('crystal-glow', rx + rw / 2 - 20, ry - 36, 40, 40, op(0.3 + 0.7 * e));
          P('crystal', rx + rw / 2 - 6, ry - 26, 12, 20);
        }
      }
    }
    function grid(
      ax: number,
      ay: number,
      aw: number,
      ah: number,
      cols: number,
      rows: number,
      ww: number,
      wh: number,
      skip?: (r: number, c: number) => boolean,
    ) {
      const gx = (aw - cols * ww) / (cols + 1);
      const gy = (ah - rows * wh) / (rows + 1);
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          if (skip?.(r, c)) continue;
          win(x + ax + gx + c * (ww + gx), y + ay + gy + r * (wh + gy), ww, wh, ti, S);
        }
      return { gx, gy };
    }

    if (b === 'housing') {
      shell('#CBA993', 0, 12, w, h - 12);
      const aw = w - 22;
      const gg = grid(4, 14, aw, h - 16, 3, 2, 20, 19, (r, c) => r === 1 && c === 1);
      P(`door d${S}`, 4 + 2 * gg.gx + 22, h - 27, 16, 27);
      const balY = 14 + gg.gy + 19;
      fig(x + 4 + gg.gx * 3 + 50, y + balY + 3, 'walk', '--walk:-14px;');
      P(`rail r${S}`, 4 + gg.gx * 2 + 18, balY - 6, aw - 2 * gg.gx - 16, 10);
      P(`ladder l${S}`, w - 14, 10, 9, h - 10);
      if (S === 2) {
        P('pipe', w * 0.72, -6, 8, 18);
        P('pipecap', w * 0.72 - 2, -9, 12, 4);
        P('ant', 12, -18, 2, 20);
        P('laundry', 13, -12, w * 0.72 - 15, 11);
      } else if (S === 1) P('laundry', 6, 22, w * 0.5, 11);
    } else if (b === 'farm') {
      const dry = lowHealth ? ' dry' : '';
      P(`dome-back d${S}`, 3, 2, w - 6, h - 16);
      P(`bed${dry}`, 30, h - 64, w - 60, 13);
      P(`bed${dry}`, 17, h - 46, w - 34, 13);
      P(`bed${dry}`, 9, h - 28, w - 18, 13);
      fig(x + w * 0.68, y + h - 16);
      if (S === 3) P('growlamp', 18, 16, w - 36, 5, op(0.4 + 0.6 * e));
      P(`dome d${S}`, 3, 2, w - 6, h - 16);
      if (S === 1) {
        L('rope', 2, h - 18, w * 0.3, 6, 1.5);
        L('rope', w - 2, h - 18, w * 0.7, 6, 1.5);
      }
      P(`fac${sS}`, 0, h - 16, w, 16, '--bc:#5b5f52;');
      P(`pipeh p${S}`, 0, h - 11, w, 5);
      if (S >= 2) P('valve', w - 18, h - 14, 10, 10);
    } else if (b === 'catcher') {
      const cx = w / 2;
      shell('#9D7D68', w * 0.18, h - 30, w * 0.64, 30, true);
      win(x + w * 0.18 + 9, y + h - 22, 14, 12, ti, S);
      win(x + w * 0.82 - 23, y + h - 22, 14, 12, ti, S);
      P(`pylon y${S}`, cx - 9, 16, 18, h - 46);
      P('ether-flow', cx - 2, 12, 4, h - 42, op(0.15 + 0.85 * e));
      if (S === 1) {
        L('rope', cx, 22, w * 0.2, h - 30, 1.5);
        L('rope', cx, 22, w * 0.8, h - 30, 1.5);
      }
      P(`horn h${S}`, cx - 38, -8, 76, 30);
      if (S >= 2) {
        P('ant', cx - 34, -30, 2, 24);
        P('ant', cx + 32, -26, 2, 20);
        P('ant-tip', cx - 36, -33, 6, 6);
        P('ant-tip', cx + 30, -29, 6, 6);
      }
      if (S === 3) P('crystal', cx - 6, 10, 12, 20);
      P('spark', cx - 15, -26, 30, 30, op(0.25 + 0.75 * e));
      fig(x + w * 0.1, y + h);
    } else if (b === 'core') {
      const d = Math.min(w - 40, h) - 16;
      const ccx = w / 2;
      const ccy = h / 2 + 2;
      P('core-halo', ccx - d, ccy - d, d * 2, d * 2, op(0.15 + 0.85 * e));
      P(`pipeh p${S}`, 0, h - 28, w, 9);
      P(`core-base b${S}`, ccx - d * 0.55, h - 14, d * 1.1, 14);
      P('core-orbit', ccx - d / 2 - 18, ccy - 9, d + 36, 18, op(0.3 + 0.7 * e));
      P(
        'core-orbit tilt',
        ccx - d / 2 - 12,
        ccy - 7,
        d + 24,
        14,
        `transform:rotate(58deg);${op(0.2 + 0.6 * e)}`,
      );
      P('core', ccx - d / 2, ccy - d / 2, d, d, op(0.35 + 0.65 * e));
      P(`core-cage c${S}`, ccx - d / 2 - 5, ccy - d / 2 - 5, d + 10, d + 10);
      P('core-orbit front', ccx - d / 2 - 18, ccy - 9, d + 36, 18, op(0.3 + 0.7 * e));
      P(`clamp c${S}`, ccx - 10, ccy - d / 2 - 13, 20, 9);
      P('gauge', 6, h - 56, 18, 18);
      if (S === 3) {
        P('crystal', 8, h - 50, 10, 18);
        P('crystal', w - 18, h - 50, 10, 18);
      }
      if (S === 1) {
        L('rope', ccx - d / 2 - 4, ccy - d / 3, ccx - d * 0.55, h - 12, 1.5);
        L('rope', ccx + d / 2 + 4, ccy - d / 3, ccx + d * 0.55, h - 12, 1.5);
      }
      fig(x + w - 14, y + h);
    } else if (b === 'council') {
      shell('#B32E35', 0, 18, w, h - 18, true);
      P(`attic a${S}`, w * 0.14, 3, w * 0.72, 16);
      P(`emblem e${S}`, w / 2 - 13, -16, 26, 26);
      P(`star sm${S === 3 ? ' glow' : ''}`, w / 2 - 8, -12, 16, 16);
      P('council-t', 6, 21, w - 12, 13, '', 'СОВЕТ');
      P('pilasters', 6, 36, w - 12, h - 44);
      grid(6, 36, w - 12, h - 46, 3, 1, 14, 28, (_r, c) => c === 1);
      P(`door d${S}`, w / 2 - 9, h - 30, 18, 30);
      P('steps', w / 2 - 20, h - 6, 40, 6);
      fig(x + w * 0.3, y + h);
    } else if (b === 'infirmary') {
      if (S === 1) {
        P('tent', 0, 6, w, h - 6);
        L('rope', 2, h - 2, w * 0.18, 26, 1.5);
        L('rope', w - 2, h - 2, w * 0.82, 26, 1.5);
        P('tent-door', w / 2 - 13, h - 36, 26, 36);
        P('cross-sign', w / 2 - 12, 18, 24, 24);
      } else {
        shell('#E9E2CF', 0, 12, w, h - 12);
        grid(2, 14, w * 0.3, h - 18, 1, 2, 16, 17);
        grid(w * 0.7 - 2, 14, w * 0.3, h - 18, 1, 2, 16, 17);
        P(`cross-sign${S === 3 ? ' glow' : ''}`, w / 2 - 15, 18, 30, 30);
        P(`door d${S}`, w / 2 - 9, h - 28, 18, 28);
        P('awning', w / 2 - 20, h - 36, 40, 9);
      }
      fig(x + w * 0.8, y + h, 'medic');
    } else if (b === 'guard') {
      // Пост: стена с зубцами, сторожевая башенка с прожектором справа, звезда над дверью
      const tx = w - 46;
      shell('#536E71', 0, 26, w, h - 26, true);
      P(`merlons k${S}`, 0, 17, tx - 2, 9);
      P('beam', tx + 34, -30, 96, 46, op(lowOrder ? 0.12 : 0.6));
      P(`booth b${S}`, tx, -2, 40, 30);
      P('booth-cap', tx - 6, -11, 52, 10);
      P('slit', tx + 6, 6, 28, 5);
      P(`lamp${S === 3 ? ' ether' : ''}`, tx + 30, -6, 12, 12);
      grid(4, 30, w - 8, h - 38, 3, 1, 9, 18, (_r, c) => c === 1);
      P('star sm', w / 2 - 7, 33, 14, 14);
      P(`door d${S}`, w / 2 - 9, h - 30, 18, 30);
      if (S === 1) {
        P('sandbags', 2, h - 15, w * 0.32, 15);
        P('sandbags', w * 0.66 - 2, h - 15, w * 0.34, 15);
      } else {
        P('siren', tx - 14, 3, 14, 10);
        P('post', w * 0.64, h - 22, 5, 22);
        P('barrier', w * 0.64 + 2, h - 19, w * 0.32, 5);
      }
      fig(x + w * 0.2, y + h, 'guard');
    } else if (b === 'scrap') {
      // Цех с пилообразной крышей, кран с кабиной, куча лома с листами и бочкой
      const sx0 = w * 0.46;
      const sw0 = w * 0.54;
      shell('#648083', sx0, h - 36, sw0, 36, true);
      P(`sawroof r${S}`, sx0, h - 49, sw0, 13);
      P('gate', sx0 + 10, h - 26, sw0 - 20, 26);
      P(`lattice y${S}`, 10, 2, 12, h - 2);
      P(`cab c${S}`, 5, 24, 22, 15);
      P(`jib y${S}`, 2, 2, w - 12, 9);
      P('cweight', 0, 11, 16, 13);
      P('hookline', w - 18, 11, 1.5, h * 0.36);
      P(S === 3 ? 'magnet' : 'hook', w - 23, 11 + h * 0.36, 11, 10);
      P('b-pile', w * 0.02, h - 24, w * 0.5, 24);
      P('sheet', w * 0.08, h - 30, 18, 24, 'transform:rotate(-14deg);');
      P('gear', w * 0.2, h - 20, 16, 16);
      P('barrel', w * 0.36, h - 15, 11, 15);
      fig(x + w * 0.42, y + h);
    } else if (b === 'radio') {
      // Рубка с окном и тарелкой на крыше, решётчатая мачта на растяжках, волны сигнала
      const hw = Math.round(w * 0.62);
      const mx = w * 0.8;
      L('wire', mx, -24, 6, h - 44, 1.2);
      L('wire', mx, -24, w - 2, h - 2, 1.2);
      P(`radiomast y${S}`, mx - 9, -32, 18, h + 2);
      P('ring wave', mx - 8, -36, 16, 16, op(0.5 + 0.5 * e));
      P('ring wave', mx - 15, -43, 30, 30, `${op(0.3 + 0.4 * e)}animation-delay:-.6s;`);
      P('ring wave', mx - 22, -50, 44, 44, `${op(0.15 + 0.3 * e)}animation-delay:-1.2s;`);
      P('beacon', mx - 3, -38, 6, 6);
      P(`booth b${S}`, mx - 12, h - 18, 24, 18);
      shell('#6F8E91', 2, h - 44, hw, 44);
      win(x + 9, y + h - 34, 18, 15, ti, S);
      P(`door d${S}`, hw - 20, h - 26, 15, 26);
      P('dish-arm', 2 + hw * 0.24, h - 56, 3, 12);
      P('dish', 2 + hw * 0.24 - 10, h - 68, 22, 15, 'transform:rotate(-28deg);');
    } else if (b === 'corner') {
      shell('#9A3335', 0, 12, w, h - 12);
      P('poster', 8, 20, w * 0.34, h - 38);
      P('star sm', 8 + w * 0.17 - 7, 26, 14, 14);
      grid(w * 0.42, 14, w * 0.58 - 4, h * 0.42, 2, 1, 22, 18);
      fig(x + w * 0.54, y + h - 2);
      fig(x + w * 0.86, y + h - 2);
      P(`table t${S}`, w * 0.46, h - 16, w * 0.46, 16);
      P('garland', 6, 12, w - 12, 10);
    } else if (b === 'observatory') {
      // Купол на латунном барабане, раскрытая щель со звёздами, труба телескопа из щели
      const dw = w * 0.7;
      const dx = (w - dw) / 2;
      const base = h * 0.5;
      const dh = h * 0.42;
      const dt = base - 7 - dh;
      shell('#6B878A', 0, base, w, h - base, true);
      P(`drum o${S}`, dx - 5, base - 7, dw + 10, 8);
      P(`obsdome o${S}`, dx, dt, dw, dh);
      P('dome-slit', w / 2 - 7, dt + 1, 14, dh - 1);
      P(
        `scope s${S}`,
        w / 2 - 4,
        base - 9 - (dh + 12),
        8,
        dh + 12,
        'transform:rotate(22deg);transform-origin:50% 100%;',
      );
      grid(4, base + 4, w - 8, h - base - 8, 3, 1, 14, 14);
    } else {
      // Здание без рисунка: общий корпус, чтобы новое здание из данных не пропало с экрана
      shell('#8E7A6A', 0, 12, w, h - 12);
      grid(4, 14, w - 8, h - 16, 3, 1, 16, 18);
    }
  }

  const topY = ym(A + 10 * n);
  const rootW = tw(0);

  // Небо: облака и тёплый свет над Мглой
  open('sky', 'sky');
  const skyH = (A + 10 * n + 22) * K;
  const skyTop = -(10 * n + 22) * K;
  for (const [i, c] of [
    [0.05, 0.08, 96],
    [0.6, 0.04, 124],
    [0.74, 0.27, 82],
    [0.1, 0.4, 70],
  ].entries()) {
    const cw = (c[2] ?? 0) * U;
    px(`cloud cl${i % 2}`, (c[0] ?? 0) * 900 - 450, skyTop + (c[1] ?? 0) * skyH, cw, cw * 0.28);
  }

  open('mist-back', 'mistBack');
  px(
    'glow',
    -MIST_HALF,
    -130 * U,
    2 * MIST_HALF,
    150 * U,
    'background:linear-gradient(180deg,rgba(246, 149, 80,0),rgba(246, 149, 80,.2));',
  );
  mistLayer(0);

  function mistLayer(i: number): void {
    const cols = ['rgba(110, 138, 141,.6)', 'rgba(144, 173, 176,.7)', 'rgba(176, 206, 210,.82)'];
    const c = cols[i];
    const top = -40 + i * 30;
    px(
      `mist m${i}`,
      -MIST_HALF,
      top,
      2 * MIST_HALF,
      MIST_DEPTH,
      `background:radial-gradient(100px 38px at 100px 38px,${c} 96%,transparent 100%) 0 0/200px 38px repeat-x,linear-gradient(${c},${c}) 0 36px/100% 100% no-repeat;`,
    );
  }

  // Центральная шахта и внешний лифт
  open('frame', 'tower');
  const roofTop = topY - 46;
  px('shaft', -16, roofTop, 32, -roofTop + 44);
  const liftX = -rootW / 2 - OV - 44;
  const spYb = n > 1 ? ym(A + 10 * (n - 1)) : 0;
  px('liftshaft', liftX, spYb - 44, 18, -spYb + 56);
  tiers.forEach((_t, i) => {
    const gy = ym(A + 10 * i);
    const gx = -tw(i) / 2 - OV;
    px('gang', liftX + 18, gy - GEOM.deck, gx - liftX - 18, 5);
  });
  px('lift', liftX + 2, -GEOM.deck - 22, 14, 20, `--lift:${r1(spYb)}px;`);

  // Двигатели и киль под Корнем; эфирная подушка: линза света, струи, волны давления, искры.
  // Яркость и скорость — от эфира: при нехватке подушка тускнеет, замедляется и рвётся.
  open('engine', 'tower');
  const spin = `animation-duration:${(0.18 / Math.max(e, 0.08)).toFixed(2)}s;`;
  const reach = Math.max(90, Math.min(gapPx - 70, 330));
  const pace = 1 / Math.max(e, 0.3);
  const dur = (sec: number) => `animation-duration:${(sec * pace).toFixed(2)}s;`;
  const weak = e < 0.5;
  px('cushion', -270, 30, 540, reach + 60, op(0.15 + 0.6 * e) + dur(3.2));
  px('motes', -130, 72, 260, reach, op(0.1 + 0.8 * e) + dur(2.2));
  for (const side of [-1, 1]) {
    px(`jet side${weak ? ' weak' : ''}`, side * 200 - 62, 66, 124, reach * 0.7, op(0.1 + 0.5 * e) + dur(1.1));
  }
  px(`jet${weak ? ' weak' : ''}`, -26, 74, 52, reach, op(0.15 + 0.75 * e) + dur(0.9));
  if (e > 0.15)
    for (let k = 0; k < 3; k++) {
      px(
        'shock',
        -46,
        78,
        92,
        18,
        `--fall:${Math.round(reach * 0.75)}px;${dur(2.4)}animation-delay:${(-0.8 * k * pace).toFixed(2)}s;`,
      );
    }
  const splash = e > 0.15 && gapPx - 70 <= 330;
  for (const side of [-1, 1]) {
    const ex = side * 200;
    line('strut-d', side * 96, 6, ex - side * 30, 32, 6);
    px('strut', ex - 5, 0, 10, 24);
    px('pod', ex - 40, 20, 80, 30);
    px(`pod-nose ${side < 0 ? 'l' : 'r'}`, side < 0 ? ex - 54 : ex + 38, 24, 16, 22);
    px('hub', ex - 7, 46, 14, 12);
    px('duct', ex - 72, 52, 144, 16);
    px('prop', ex - 66, 56, 132, 8, spin);
  }
  px('keel', -110, 0, 220, 66);
  px('nozzle-glow', -32, 70, 64, 34, op(0.2 + 0.8 * e));
  px('nozzle', -24, 58, 48, 18);
  if (close) px('icicles', -rootW / 2 - OV, 4, rootW + 2 * OV, 14);

  // Ярусы снизу вверх: ферма под палубой верхнего, стена, карниз, пилоны, здания, палуба с перилами
  tiers.forEach((t, i) => {
    const w = tw(i);
    const x0 = -w / 2;
    const yt = ym(A + 10 * (i + 1));
    const yb = ym(A + 10 * i);
    const h = yb - yt;
    const top = t.kind === 'spire';
    open(`tier:${ids[i]}`, 'tower', i, yb);
    if (t.abandoned) {
      groupLit = 0;
      noPeople = true;
    }
    px(top ? 'frieze' : 'truss', x0 + (top ? 0 : 10), yt, w - (top ? 0 : 20), GEOM.truss);
    px('tier', x0, yt + GEOM.truss, w, h - GEOM.truss, lowSol ? `--tc:${TINTS[i % TINTS.length]};` : '');
    px('cornice', x0 - 4, yt + GEOM.truss, w + 8, 7);
    px('pillar', x0, yt + GEOM.truss + 7, 10, h - GEOM.truss - 7);
    px('pillar', x0 + w - 10, yt + GEOM.truss + 7, 10, h - GEOM.truss - 7);
    if (top) spireRoof(w, x0, yt, yb);
    const inner = 12;
    const slotW = (w - 2 * inner) / 3;
    const by = yt + GEOM.truss + 9;
    const bh = yb - GEOM.deck - by;
    t.slots.forEach((v, j) => {
      const sx = x0 + inner + j * slotW;
      const sl = normalizeSlot(v);
      slotRects.push({
        tier: i,
        slot: j,
        kind: t.kind,
        b: sl?.b ?? null,
        x: r1(sx),
        y: r1(by),
        w: r1(slotW),
        h: r1(bh),
      });
      building(sl, sx + 3, by, slotW - 6, bh, i);
      if (labels)
        px(
          `slab${sl ? '' : ' empty'}`,
          sx + 10,
          yb - GEOM.deck - 25,
          slotW - 20,
          22,
          '',
          sl ? (TOWER_NAMES[sl.b] ?? sl.b) : '+ слот',
        );
    });
    px('deck', x0 - OV, yb - GEOM.deck, w + 2 * OV, GEOM.deck + 4);
    px('bracket l', x0 - OV, yb + 4, OV, 18);
    px('bracket r', x0 + w, yb + 4, OV, 18);

    // Жители на балконе
    if (hash01(i + 5) > 0.35 && !lowHealth)
      fig(x0 + w + 12, yb - GEOM.deck, 'walk', `--walk:-8px;animation-duration:${5 + i}s;`);
    // Сады на балконах и плющ под палубой (здоровье)
    if (!top && hiHealth) {
      px('bush', x0 - OV + 1, yb - GEOM.deck - 15, 13, 15);
      px('bush', x0 - OV + 9, yb - GEOM.deck - 19, 12, 19);
      px('bush', x0 + w + OV - 13, yb - GEOM.deck - 14, 12, 14);
      px('vine', x0 - OV, yb + 4, OV, 26);
      px('vine', x0 + w, yb + 4, OV, 20);
    } else if (!top && lowHealth) {
      px('bush dry', x0 - OV + 2, yb - GEOM.deck - 10, 14, 10);
    }
    px('rail', x0 - OV, yb - GEOM.deck - 14, OV - 2, 14);
    px('rail', x0 + w + 2, yb - GEOM.deck - 14, OV - 2, 14);
    // Патрули с фонарями (порядок)
    if (hiOrder) {
      px('lantern', x0 - OV + 4, yb + 6, 8, 12);
      px('lantern', x0 + w + OV - 12, yb + 6, 8, 12);
      fig(x0 - OV + 12, yb - GEOM.deck, 'guard walk', '--walk:6px;animation-duration:7s;');
    }
    // Гирлянда флажков под палубой верхнего яруса (солидарность)
    if (hiSol && !top) px('garland', x0 + 12, yt + 1, w - 24, 16);
    // Брошенный ярус: окна погасли, людей нет, серая пелена
    if (t.abandoned) px('film abandoned', x0 - OV, yt, w + 2 * OV, h + 4);
  });

  // Крыша Шпиля в три ступени, мачта с растяжками, звезда с гранями (доверие).
  // Рисуется до зданий Шпиля, чтобы антенны и герб стояли перед крышей.
  function spireRoof(w: number, x0: number, yt: number, yb: number): void {
    const r1y = yt - 16;
    const r2y = yt - 32;
    const r3y = yt - 46;
    px('roofstep', x0 + 8, r1y, w - 16, 16);
    px('roofstep', x0 + 52, r2y, w - 104, 16);
    px('roofstep hi', x0 + 100, r3y, w - 200, 14);
    const b0 = r3y - 10;
    const p1 = b0 - 50;
    const p2 = p1 - 4 - 38;
    const ntop = p2 - 3 - 16;
    const ballY = ntop - 8;
    line('wire', 0, p1 + 2, x0 + 16, r1y + 1, 1.5);
    line('wire', 0, p1 + 2, x0 + w - 16, r1y + 1, 1.5);
    line('wire', 0, p2 + 4, x0 + 58, r2y + 1, 1.5);
    line('wire', 0, p2 + 4, x0 + w - 58, r2y + 1, 1.5);
    px('mast-base', -24, b0, 48, 10);
    px('mast', -16, p1, 32, b0 - p1);
    line('mast-leg', -16, b0, -7, p1, 3);
    line('mast-leg', 16, b0, 7, p1, 3);
    px('mast-deck', -19, p1 - 4, 38, 5);
    px('mast', -8, p2, 16, p1 - 4 - p2);
    line('mast-leg', -8, p1 - 4, -3, p2, 2.5);
    line('mast-leg', 8, p1 - 4, 3, p2, 2.5);
    px('dipole', -26, p2 + 12, 52, 3);
    px('dipole', -18, p2 + 25, 36, 3);
    px('mast-deck', -11, p2 - 3, 22, 4);
    px('needle', -2, ntop, 4, p2 - 2 - ntop);
    px('avl', -23, p1 - 10, 6, 6);
    px('avl', 17, p1 - 10, 6, 6, 'animation-delay:-1.2s;');
    px('avl', -15, p2 - 9, 5, 5, 'animation-delay:-.6s;');
    px('avl', 10, p2 - 9, 5, 5, 'animation-delay:-1.8s;');
    px('ball', -6, ballY, 12, 12);
    // Правильная пятиконечная звезда: центр на 54,8 % высоты рамки, нижние лучи — на 95,2 %
    const mode = st.trust >= 60 ? '' : st.trust >= 30 ? ' blink' : ' off';
    const cy = ballY + 4 - 0.4045 * 78;
    px(`star-halo${mode}`, -68, cy - 68, 136, 136);
    px(`star rim${mode}`, -39, cy - 0.5478 * 78, 78, 78);
    px(`star big${mode}`, -32, cy - 0.5478 * 64, 64, 64);
    if (hiTrust) {
      [x0 + 12, x0 + w - 15].forEach((fx, k) => {
        px('pole', fx, r1y - 54, 3, 54);
        px('flag', fx + 3, r1y - 54, 36, 21, k ? 'animation-delay:-.7s;' : '');
      });
    }
    if (lowTrust) {
      fig(x0 + w + 6, yb - GEOM.deck);
      fig(x0 + w + 14, yb - GEOM.deck + 1);
      fig(x0 + w + 21, yb - GEOM.deck);
      px('placard', x0 + w + 8, yb - GEOM.deck - 40, 16, 12, '', '!');
    }
  }

  // Баррикады на балконах, надписи (солидарность)
  if (lowSol) {
    open('solidarity', 'tower');
    for (let i = 1; i < n; i++) {
      const jy = ym(A + 10 * i) - GEOM.deck;
      const jw = tw(i);
      const jx = -jw / 2;
      for (const bx of [jx - OV + 1, jx + jw + 1]) {
        px('crate', bx + 2, jy - 12, 13, 12);
        px('plank', bx - 3, jy - 16, 30, 4, 'transform:rotate(28deg);');
        px('plank', bx - 3, jy - 16, 30, 4, 'transform:rotate(-28deg);');
      }
      if (i < n - 1)
        px(
          'graffiti',
          jx + jw * 0.3,
          jy,
          150,
          14,
          'transform:rotate(-3deg);',
          i % 2 ? 'НАШ ЯРУС' : 'ВЕРХ ДЛЯ ВЕРХНИХ?',
        );
    }
  }
  // Транспарант (доверие)
  if (n > 2 && (hiTrust || lowTrust)) {
    open('banner', 'tower');
    const bx1 = tw(1) / 2 + OV + 6;
    const by1 = ym(A + 20) + 2;
    px('rod', bx1 - 4, by1, 40, 4);
    if (hiTrust) px('banner', bx1, by1 + 4, 30, 200, '', 'ВСЕ НА ВЫСОТУ');
    else px('banner torn', bx1, by1 + 4, 30, 120, '', 'ВСЕ НА');
  }
  // Костёр в бочке, толпа (порядок); дым — в отдельном слое поверх башни
  if (lowOrder) {
    open('order', 'tower');
    const t1 = Math.min(1, n - 1);
    const w1 = tw(t1);
    const x1 = -w1 / 2;
    const yb1 = ym(A + 10 * t1) - GEOM.deck;
    px('fire', x1 - OV + 2, yb1 - 30, 16, 18);
    px('barrel', x1 - OV + 4, yb1 - 15, 12, 15);
    const rx = rootW / 2 + 2;
    const ry = -GEOM.deck;
    fig(rx + 5, ry);
    fig(rx + 12, ry + 1);
    fig(rx + 19, ry);
    open('smoke', 'smoke');
    for (const p of [
      [w1 / 2 - 60, ym(A + 10 * (t1 + 1)) - 20],
      [-rootW / 2 + 24, ym(A + 10) - 20],
    ]) {
      for (let k = 0; k < 3; k++) px(`smoke sd${k}`, p[0] ?? 0, p[1] ?? 0, 44, 44);
    }
  }
  // Серый налёт (здоровье)
  if (lowHealth) {
    open('film', 'tower');
    px('film', -rootW / 2 - OV, topY - 60, rootW + 2 * OV, -topY + 60);
  }

  // Шрамы: трещины с заплатами, обрубок балки с оборванными тросами, памятная табличка
  const stumpAt = sc.stumpAt;
  if ((sc.patches?.length ?? 0) > 0 || (stumpAt != null && tiers[stumpAt])) {
    open('scars', 'tower');
    for (const pt of sc.patches ?? []) {
      const ti = pt[0];
      if (!tiers[ti]) continue;
      const w2 = tw(ti);
      const tx = -w2 / 2 + pt[1] * w2;
      const ty = ym(A + 10 * (ti + 1)) + pt[2] * 10 * K;
      px('crack', tx - 7, ty - 12, 14, 52);
      px('patch', tx - 15, ty + 6, 30, 22);
    }
    if (stumpAt != null && tiers[stumpAt]) {
      const sw = tw(stumpAt);
      const sy = ym(A + 10 * (stumpAt + 1));
      px('stump', sw / 2 - 10, sy - 18, 132, 24);
      px('cable-hang', sw / 2 + 108, sy + 4, 2, 64);
      px('cable-hang', sw / 2 + 64, sy + 4, 2, 40, 'transform:rotate(-8deg);');
      px('cable-hang', sw / 2 + 30, sy + 4, 2, 24, 'transform:rotate(14deg);');
      if (sc.memorial) {
        const mw = tiers[stumpAt + 1] ? tw(stumpAt + 1) : sw;
        const mx = -mw / 2 - OV + 1;
        px('memorial', mx, sy - GEOM.deck - 30, 22, 28);
        px('star sm', mx + 6, sy - GEOM.deck - 26, 10, 10);
        px('wreath', mx + 3, sy - GEOM.deck - 14, 16, 10);
      }
    }
  }

  // Мгла спереди и рябь там, где струя достаёт до Мглы
  open('mist-front', 'mistFront');
  mistLayer(1);
  mistLayer(2);
  px('underglow', -MIST_HALF, 20 * U, 2 * MIST_HALF, MIST_DEPTH);
  if (splash) {
    px('splash-glow', -230, -40, 460, 80, op(0.3 + 0.6 * e));
    px('splash', -170, -22, 340, 44, dur(2.6));
    px('splash', -170, -22, 340, 44, `${dur(2.6)}animation-delay:${(-1.3 * pace).toFixed(2)}s;`);
  }
  // Клубы у Корня, когда Мгла близко
  if (close) {
    open('wisps', 'over');
    px('wisp', -375, -110, 750, 215);
    px('wisp', -250, -185, 425, 160, 'animation-duration:8s;');
  }

  const tilt = e < 0.5 ? +((0.5 - e) * 8).toFixed(1) : 0;
  const boundsTop = topY - 280;
  const boundsBottom = clamp(gapPx + 150, 320, 950);
  return {
    groups,
    gapPx,
    tilt,
    bounds: { x: -390, y: boundsTop, w: 780, h: boundsBottom - boundsTop },
    close,
    cushionWeak: weak,
    starMode: st.trust >= 60 ? 'on' : st.trust >= 30 ? 'blink' : 'off',
    lit,
    slots: slotRects,
  };
}

/** Стиль детали так же, как в макете: координаты и доп. стиль. */
export function partStyle(p: Part): string {
  return `left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px;${p.s}`;
}
