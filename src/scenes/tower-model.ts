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
          P('crystal-glow', rx + rw / 2 - 16, ry - 30, 32, 32, op(0.3 + 0.7 * e));
          P('crystal', rx + rw / 2 - 5, ry - 21, 10, 14);
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
        P('pipe', w * 0.72, -2, 8, 14);
        P('pipecap', w * 0.72 - 2, -5, 12, 4);
        P('ant', 12, -8, 2, 14);
        P('laundry', 13, -4, w * 0.72 - 15, 11);
      } else if (S === 1) P('laundry', 6, 22, w * 0.5, 11);
    } else if (b === 'farm') {
      // Теплица: стеклянный купол с рёбрами-меридианами на цоколе. Внутри два яруса растений разной
      // формы — сзади высокие кусты на шпалере, спереди круглые кочаны в лотке с бегущей водой.
      // 1 — деревянные рёбра, плёнка с заплатами, ящики и бочка; 2 — сталь, стекло, гидропоника
      // и тёплые лампы; 3 — латунь, эфирные лампы со световыми конусами, больше плодов.
      const dry = lowHealth ? ' dry' : '';
      const dh = h - 16;
      const fs = ` f${S}`;
      P(`dome-back d${S}`, 3, 2, w - 6, dh);
      if (S >= 2)
        for (const k of [0.33, 0.67]) {
          P(
            `lamp-cone${S === 3 ? ' ether' : ''}`,
            w * k - 20,
            18,
            40,
            dh - 30,
            op(S === 3 ? 0.35 + 0.65 * e : 1),
          );
          P('hookline', w * k - 0.75, 7, 1.5, 9);
          P(`growlamp${S === 3 ? ' ether' : ''}`, w * k - 9, 15, 18, 5);
        }
      P(`plant tall${fs}${dry}`, 24, dh - 52, w - 48, 40);
      P(`shelf${fs}`, 18, dh - 13, w - 36, 5);
      P(`plant leafy${dry}`, 9, dh - 21, w - 18, 15);
      P(`trough${fs}${dry}`, 8, dh - 7, w - 16, 7);
      if (S === 1) P('barrel', w - 26, dh - 15, 11, 15);
      fig(x + w * 0.7, y + dh);
      P(`dome d${S}`, 3, 2, w - 6, dh);
      P(`dome-rib d${S}`, 3 + (w - 6) * 0.19, 2, (w - 6) * 0.62, dh);
      P(`dome-rib d${S}`, 3 + (w - 6) * 0.37, 2, (w - 6) * 0.26, dh);
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
      P(`horn h${S}`, cx - 38, -2, 76, 26);
      if (S >= 2) {
        P('ant', cx - 34, -6, 2, 20);
        P('ant', cx + 32, -4, 2, 18);
        P('ant-tip', cx - 36, -9, 6, 6);
        P('ant-tip', cx + 30, -7, 6, 6);
      }
      if (S === 3) P('crystal', cx - 6, 10, 12, 20);
      P('spark', cx - 15, -3, 30, 16, op(0.25 + 0.75 * e));
      fig(x + w * 0.1, y + h);
    } else if (b === 'core') {
      // Эфирный реактор: стеклянная сфера с вихрями света внутри и бьющимся сердцем, обручи кардана
      // (задняя половина за сферой, передняя перед ней), опоры от стен, постамент и световод в потолок.
      // 1 — один железный обруч на досках и верёвках; 2 — стальной кардан из двух обручей;
      // 3 — латунный кардан из трёх обручей с эфирной насечкой, кристаллы на опорах.
      const d = Math.min(w - 64, h - 18);
      const ccx = w / 2;
      const ccy = h / 2 - 1;
      const cs = ` c${S}`;
      const R = d / 2;
      const eqW = d + 28;
      const eqH = Math.round(eqW * 0.28);
      const mW = Math.round((d + 12) * 0.36);
      const mH = d + 12;
      const rings: [string, number, number, number, number, string][] = [
        ['eq', ccx - eqW / 2, ccy - eqH / 2, eqW, eqH, ''],
      ];
      if (S >= 2) rings.push(['mer', ccx - mW / 2, ccy - mH / 2, mW, mH, 'transform:rotate(24deg);']);
      if (S === 3)
        rings.push([
          'mer',
          ccx - mW / 2,
          ccy - mH / 2,
          mW,
          mH,
          'transform:rotate(-24deg);animation-delay:-3s;',
        ]);
      P('core-halo', ccx - d * 0.95, ccy - d * 0.6, d * 1.9, d * 1.2, op(0.15 + 0.85 * e));
      P(`pipeh p${S}`, 0, h - 30, w, 9);
      P(`core-conduit${cs}`, ccx - 4, -10, 8, ccy - R + 12);
      P('core-flow', ccx - 1.5, -10, 3, ccy - R + 10, op(0.15 + 0.85 * e));
      P(`core-arm${cs}`, 2, ccy - 5, ccx - eqW / 2 + 2, 10);
      P(`core-arm${cs}`, ccx + eqW / 2 - 4, ccy - 5, w - 2 - (ccx + eqW / 2 - 4), 10);
      for (const r of rings) P(`core-ring ${r[0]} back${cs}`, r[1], r[2], r[3], r[4], r[5]);
      P(`core${cs}`, ccx - R, ccy - R, d, d, op(0.35 + 0.65 * e));
      P('core-swirl', ccx - d * 0.41, ccy - d * 0.41, d * 0.82, d * 0.82, op(0.2 + 0.8 * e));
      P('core-swirl rev', ccx - d * 0.41, ccy - d * 0.41, d * 0.82, d * 0.82, op(0.15 + 0.7 * e));
      P('core-heart', ccx - d * 0.2, ccy - d * 0.17, d * 0.4, d * 0.4, op(0.3 + 0.7 * e));
      P('core-glint', ccx - d * 0.33, ccy - d * 0.37, d * 0.3, d * 0.17, 'transform:rotate(-32deg);');
      for (const r of rings) P(`core-ring ${r[0]} front${cs}`, r[1], r[2], r[3], r[4], r[5]);
      P('core-pin', ccx - eqW / 2 - 3, ccy - 4, 8, 8);
      P('core-pin', ccx + eqW / 2 - 5, ccy - 4, 8, 8);
      P(`core-cap${cs}`, ccx - 9, ccy - R - 5, 18, 8);
      P(`core-base b${S}`, ccx - d * 0.42, ccy + R - 4, d * 0.84, h - (ccy + R - 4));
      P('gauge', 7, h - 27, 15, 15);
      if (S === 3) {
        P('crystal', 9, ccy - 21, 9, 16);
        P('crystal', w - 18, ccy - 21, 9, 16);
      }
      if (S === 1) {
        L('rope', ccx - R - 6, ccy + 3, ccx - d * 0.42, h - 8, 1.5);
        L('rope', ccx + R + 6, ccy + 3, ccx + d * 0.42, h - 8, 1.5);
      }
      fig(x + w - 12, y + h);
    } else if (b === 'council') {
      shell('#B32E35', 0, 18, w, h - 18, true);
      P(`attic a${S}`, w * 0.14, 3, w * 0.72, 16);
      P(`emblem e${S}`, w / 2 - 11, -2, 22, 22);
      P(`star sm${S === 3 ? ' glow' : ''}`, w / 2 - 7, 2, 14, 14);
      P('council-t', 6, 21, w - 12, 13, '', 'СОВЕТ');
      P('pilasters', 6, 36, w - 12, h - 44);
      grid(6, 36, w - 12, h - 46, 3, 1, 14, 28, (_r, c) => c === 1);
      P(`door d${S}`, w / 2 - 9, h - 30, 18, 30);
      P('steps', w / 2 - 20, h - 6, 40, 6);
      fig(x + w * 0.3, y + h);
    } else if (b === 'infirmary') {
      // Лазарет. 1 — полевой госпиталь: палатка с красным крестом, тёмный проём с койкой, откинутый
      // полог, носилки у входа. 2–3 — больница: белый корпус с красной полосой, световой крест над
      // входом, палаты с койками в окнах, козырёк, пандус и носилки; 3 — латунь и эфирный крест.
      if (S === 1) {
        P('tent', 0, 6, w, h - 6);
        L('rope', 2, h - 2, w * 0.18, 26, 1.5);
        L('rope', w - 2, h - 2, w * 0.82, 26, 1.5);
        P('tent-cross', w / 2 - 10, 20, 20, 20);
        P('tent-door', w / 2 - 18, h - 40, 36, 40);
        P('ward', w / 2 - 12, h - 10, 24, 8);
        P('tent-flap', w / 2 + 4, h - 40, 18, 36);
      } else {
        shell('#E9E2CF', 0, 12, w, h - 12);
        for (const wx of [8, 26, w - 40, w - 22]) win(x + wx, y + 17, 14, 13, ti, S);
        P(`cross-light${S === 3 ? ' ether' : ''}`, w / 2 - 12, 14, 24, 24);
        P('med-band', 0, 40, w, 5);
        for (const wx of [6, w - 36]) {
          win(x + wx, y + 48, 30, 18, ti, S);
          P('ward', wx + 3, 57, 24, 8);
        }
        P('awning', w / 2 - 18, h - 33, 36, 7);
        P(`door d${S}`, w / 2 - 9, h - 26, 18, 26);
        P('ramp', w / 2 + 9, h - 5, 22, 5);
      }
      P('stretcher', 6, h - 9, 30, 9);
      fig(x + w * 0.82, y + h, 'medic');
    } else if (b === 'guard') {
      // Пост: стена с зубцами, сторожевая башенка с прожектором справа, звезда над дверью
      const tx = w - 46;
      shell('#536E71', 0, 26, w, h - 26, true);
      P(`merlons k${S}`, 0, 17, tx - 2, 9);
      P('beam', tx + 34, -22, 96, 46, op(lowOrder ? 0.12 : 0.6));
      P(`booth b${S}`, tx, 6, 40, 22);
      P('booth-cap', tx - 6, -2, 52, 10);
      P('slit', tx + 6, 13, 28, 5);
      P(`lamp${S === 3 ? ' ether' : ''}`, tx + 30, 2, 12, 12);
      grid(4, 30, w - 8, h - 38, 3, 1, 9, 18, (_r, c) => c === 1);
      P('star sm', w / 2 - 7, 33, 14, 14);
      P(`door d${S}`, w / 2 - 9, h - 30, 18, 30);
      if (S === 1) {
        P('sandbags', 2, h - 15, w * 0.32, 15);
        P('sandbags', w * 0.66 - 2, h - 15, w * 0.34, 15);
      } else {
        P('siren', tx - 14, 10, 14, 10);
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
      // Рубка с окном; на её крыше тарелка на поворотной опоре. Справа решётчатая мачта на бетонной
      // опоре: площадка, штырь антенны с огнём, растяжки на крышу рубки и на палубу, фидер от рубки.
      // Волны сигнала расходятся в стороны от верхушки. Всё в пределах слота.
      const hw = Math.round(w * 0.56);
      const mx = w * 0.8;
      const mt = 15;
      const roof = h - 44;
      const dx = 2 + hw * 0.42;
      L('wire', mx, mt + 8, hw - 1, roof + 1, 1.2);
      L('wire', mx, mt + 8, w - 3, h - 2, 1.2);
      P('ring wave', mx - 15, mt - 22, 30, 30, op(0.35 + 0.65 * e));
      P('ring wave', mx - 15, mt - 22, 30, 30, `${op(0.35 + 0.65 * e)}animation-delay:-1.2s;`);
      P('mast-foot', mx - 12, h - 6, 24, 6);
      P(`radiomast y${S}`, mx - 8, mt, 16, h - 6 - mt);
      P('mast-deck', mx - 10, mt + Math.round((h - mt) * 0.4), 20, 4);
      P('ant', mx - 1, mt - 9, 2, 10);
      P('beacon', mx - 3, mt - 13, 6, 6);
      L('feeder', hw, h - 30, mx - 5, h - 34, 2);
      shell('#6F8E91', 2, roof, hw, 44, true);
      win(x + 8, y + h - 34, 18, 15, ti, S);
      P(`door d${S}`, hw - 18, h - 26, 15, 26);
      P('dish-arm', dx - 2, roof - 14, 4, 10);
      P('dish-yoke', dx - 6, roof - 6, 12, 4);
      P('dish', dx - 14, roof - 29, 28, 15, 'transform:rotate(-22deg);');
      L('dish-feed', dx, roof - 19, dx - 5, roof - 30, 1.5);
      if (S === 3) P('crystal', hw - 13, roof - 19, 9, 13);
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
        base - 9 - (dh + 4),
        8,
        dh + 4,
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
  // Внешний лифт: решётчатая шахта слева, мостки и хомуты у каждой палубы. Сверху оголовок: плита,
  // А-рама, блок под красным колпаком с огнём; через блок трос к кабине и к противовесу, они ходят
  // навстречу (одна анимация twLift, тросы тянутся twLiftRope). Снизу буфер, опорная плита и подкос.
  const liftX = -rootW / 2 - OV - 44;
  const lc = liftX + 9;
  const spYb = n > 1 ? ym(A + 10 * (n - 1)) : 0;
  const lsTop = spYb - 44;
  const lsBot = 12;
  const travel = -spYb;
  const shY = lsTop - 26;
  const cabTop = -GEOM.deck - 22;
  const cwTop = shY + 14;
  const rope = cabTop - shY;
  const rope2 = travel + 14;
  line('lift-brace', liftX + 16, lsBot - 1, -rootW / 2 - 2, 20, 5);
  px('liftshaft', liftX, lsTop, 18, lsBot - lsTop);
  px('lift-head', liftX - 4, lsTop - 4, 26, 5);
  line('lift-leg', liftX + 1, lsTop - 3, lc - 4, shY, 2.5);
  line('lift-leg', liftX + 17, lsTop - 3, lc - 4, shY, 2.5);
  tiers.forEach((_t, i) => {
    const gy = ym(A + 10 * i);
    const gx = -tw(i) / 2 - OV;
    px('gang', liftX + 18, gy - GEOM.deck, gx - liftX - 18, 5);
    px('lift-collar', liftX - 3, gy - GEOM.deck - 2, 24, 8);
  });
  px('lift-buffer', liftX + 4, -10, 10, lsBot - 4 + 10);
  px('lift-pit', liftX - 5, lsBot - 4, 28, 8);
  px('lift-rope', lc + 3.4, shY, 1.2, rope, `--r0:1;--r1:${((rope - travel) / rope).toFixed(3)};`);
  px('lift-rope', lc - 12.6, shY, 1.2, rope2, `--r0:${(14 / rope2).toFixed(3)};--r1:1;`);
  px('lift-cw', lc - 14.5, cwTop, 5, 16, `--lift:${r1(travel)}px;`);
  px('lift', liftX + 2, cabTop, 14, 20, `--lift:${r1(-travel)}px;`);
  px('lift-sheave', lc - 12, shY - 8, 16, 16);
  px('lift-hood', lc - 14, shY - 12, 20, 10);
  px('avl', lc - 7, shY - 17, 6, 6, 'animation-delay:-.9s;');

  // Двигатели и киль под Корнем; эфирная подушка: линза света, струи, волны давления, искры.
  // Яркость и скорость — от эфира: при нехватке подушка тускнеет, замедляется и рвётся.
  open('engine', 'tower');
  const reach = Math.max(90, Math.min(gapPx - 70, 330));
  const pace = 1 / Math.max(e, 0.3);
  const dur = (sec: number) => `animation-duration:${(sec * pace).toFixed(2)}s;`;
  const weak = e < 0.5;
  px('cushion', -230, 40, 460, reach + 40, op(0.12 + 0.45 * e) + dur(3.6));
  px('motes', -130, 80, 260, reach, op(0.1 + 0.8 * e) + dur(3.1));
  // Луч эфира: мягкий конус без жёстких краёв (маска-конус с вершиной над соплом). Внутри — ровное
  // свечение, два слоя неровных сгустков с разным шагом и скоростью (турбулентность без полос),
  // редкие искры, дрожащее раскалённое ядро; у главного луча под соплом — узлы скачков уплотнения.
  const beam = (bx: number, by: number, bw: number, len: number, top: number, k: number, side: boolean) => {
    const ta = (bw - top) / 2 / len;
    const a = (Math.atan(ta) * 180) / Math.PI;
    const ap = top / 2 / Math.max(ta, 0.01);
    const cone = `--a:${a.toFixed(1)}deg;--ap:${Math.round(ap)}px;`;
    const wk = weak ? ' weak' : '';
    const sd = side ? ' side' : '';
    px(`jet-halo${sd}`, bx - bw * 0.75, by - 4, bw * 1.5, len * 0.8, op(0.1 + 0.45 * e) + dur(4 * k));
    px(`jet${wk}${sd}`, bx - bw / 2, by, bw, len, cone + op(0.2 + 0.75 * e) + dur(1.8 * k));
    px(`jet-flow${sd}`, bx - bw / 2, by, bw, len, cone + op(0.15 + 0.8 * e) + dur(1.3 * k));
    px(`jet-flow slow${sd}`, bx - bw / 2, by, bw, len, cone + op(0.1 + 0.7 * e) + dur(2.1 * k));
    px('jet-spark', bx - bw / 2, by, bw, len * 0.9, cone + op(0.1 + 0.85 * e) + dur(1.1 * k));
    px(`jet-core${wk}`, bx - bw / 2, by, bw, len * 0.72, cone + op(0.25 + 0.75 * e));
    if (!side) px('jet-knots', bx - top / 2, by, top, 76, op(0.2 + 0.8 * e) + dur(0.9));
  };
  for (const side of [-1, 1]) beam(side * 200, 62, 170, reach * 0.72, 112, 1.25, true);
  beam(0, 94, 124, reach - 22, 54, 1, false);
  if (e > 0.15)
    for (let k = 0; k < 3; k++) {
      px(
        'shock',
        -40,
        98,
        80,
        16,
        `--fall:${Math.round(reach * 0.7)}px;${dur(2.4)}animation-delay:${(-0.8 * k * pace).toFixed(2)}s;`,
      );
    }
  const splash = e > 0.15 && gapPx - 70 <= 330;
  // Магнитные турбины: медная обмотка кольца, ротор с бегущими лопастями, гудящее свечение катушек,
  // расходящиеся петли поля и короткие разряды на концах кольца. Всё от эфира.
  const rotor = `animation-duration:${(0.45 / Math.max(e, 0.08)).toFixed(2)}s;`;
  for (const side of [-1, 1]) {
    const ex = side * 200;
    if (e > 0.15)
      for (let f = 0; f < 2; f++)
        px('field', ex - 92, 36, 184, 48, `${dur(2)}animation-delay:${(-f * pace).toFixed(2)}s;`);
    px('coil-glow', ex - 86, 42, 172, 36, op(0.15 + 0.85 * e) + dur(1.6));
    line('strut-d', side * 96, 6, ex - side * 30, 32, 6);
    px('strut', ex - 5, 0, 10, 24);
    px('pod', ex - 40, 20, 80, 30);
    px('pod-coil', ex - 30, 24, 60, 3, op(0.25 + 0.75 * e) + dur(0.8));
    px(`pod-nose ${side < 0 ? 'l' : 'r'}`, side < 0 ? ex - 54 : ex + 38, 24, 16, 22);
    px('hub', ex - 7, 46, 14, 12);
    px('duct', ex - 72, 52, 144, 16);
    px('prop', ex - 66, 57, 132, 6, rotor);
    if (e > 0.15) {
      px('arc', ex - 82, 46, 10, 22, `${dur(1.7)}animation-delay:${(-0.4 * (side + 2) * pace).toFixed(2)}s;`);
      px('arc', ex + 72, 46, 10, 22, `${dur(2.3)}animation-delay:${(-0.9 * (side + 2) * pace).toFixed(2)}s;`);
    }
  }
  // Киль: корпус с гранями, красным поясом на заклёпках и светящимися иллюминаторами. Сопло —
  // настоящий раструб: фланец, рулевые приводы, колокол с кольцами охлаждения и рёбрами, который
  // калится к кромке, рули по бокам; в горле видна раскалённая кромка, из неё выходит луч.
  px('keel', -110, 0, 220, 66);
  for (const dx of [-40, 0, 40]) px('keel-port', dx - 5, 30, 10, 10, op(0.4 + 0.6 * e));
  line('nozzle-rod', -30, 56, -21, 78, 3);
  line('nozzle-rod', 30, 56, 21, 78, 3);
  px('nozzle-ring', -22, 58, 44, 10);
  px('nozzle-fin l', -37, 74, 9, 18);
  px('nozzle-fin r', 28, 74, 9, 18);
  px('nozzle', -32, 66, 64, 30);
  px('nozzle-heat', -32, 66, 64, 30, op(0.2 + 0.8 * e));
  px('nozzle-glow', -46, 88, 92, 18, op(0.25 + 0.75 * e));
  px('nozzle-lip', -33, 90, 66, 10);
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
    // Шрамы на стене яруса: трещины с заплатами, за зданиями
    for (const pt of sc.patches ?? []) {
      if (pt[0] !== i) continue;
      const tx = x0 + pt[1] * w;
      const ty = yt + pt[2] * 10 * K;
      px('crack', tx - 7, ty - 12, 14, 52);
      px('patch', tx - 15, ty + 6, 30, 22);
    }
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
    // Шатёр под звезду, а не радиомачта: цоколь на верхней ступени, кирпичный барабан с часами,
    // галерея с огнями, фонарь-ротонда с тёплым светом, гранёный шатёр с золотыми рёбрами,
    // шар, шток и золотая чаша-венец, которая держит звезду между нижними лучами.
    const b0 = r3y - 10;
    const ballY = b0 - 122;
    px('spire-plinth', -28, b0, 56, 10);
    px('spire-drum', -16, b0 - 26, 32, 26);
    px('spire-clock', -7, b0 - 21, 14, 14);
    px('spire-gallery', -21, b0 - 31, 42, 6);
    px('avl', -24, b0 - 37, 6, 6);
    px('avl', 18, b0 - 37, 6, 6, 'animation-delay:-1.2s;');
    px('spire-lantern', -11, b0 - 51, 22, 21);
    px('spire-eave', -15, b0 - 55, 30, 5);
    px('spire-tent', -13, b0 - 114, 26, 60);
    px('ball', -6, ballY, 12, 12);
    px('star-stem', -2, ballY - 6, 4, 8);
    // Правильная пятиконечная звезда: центр на 54,8 % высоты рамки, нижние лучи — на 95,2 %.
    // Норма — дышащий ореол, медленные лучи, блик по граням, искры на концах лучей; мигание —
    // сбоящий свет; погасшая — тёмная, без ореола.
    const mode = st.trust >= 60 ? '' : st.trust >= 30 ? ' blink' : ' off';
    const cy = ballY - 27;
    const rt = cy - 0.5478 * 78;
    const bt = cy - 0.5478 * 64;
    px(`star-halo${mode}`, -68, cy - 68, 136, 136);
    if (!mode) px('star-rays', -80, cy - 80, 160, 160);
    px(`star rim${mode}`, -39, rt, 78, 78);
    px(`star big${mode}`, -32, bt, 64, 64);
    if (!mode) {
      px('star glint', -32, bt, 64, 64);
      px('star-flare', -9, rt - 5, 18, 18);
      px('star-flare', 37 - 9, rt + 30.7 - 9, 18, 18, 'animation-delay:-2.6s;');
      px('star-flare', -23 - 9, rt + 74.3 - 9, 18, 18, 'animation-delay:-4.1s;');
    }
    px('star-cup', -14, cy + 12, 28, 11);
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
  // На обрубке балки транспарант висит с его конца, в стороне от яруса и тросов
  const bannerOn = n > 2 && (hiTrust || lowTrust);
  const onStump = bannerOn && sc.stumpAt === 1;
  if (bannerOn) {
    open('banner', 'tower');
    const bx1 = tw(1) / 2 + (onStump ? 90 : OV + 6);
    const by1 = ym(A + 20) + (onStump ? 6 : 2);
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

  // Обрубок балки с оборванными тросами, памятная табличка
  const stumpAt = sc.stumpAt;
  if (stumpAt != null && tiers[stumpAt]) {
    open('scars', 'tower');
    const sw = tw(stumpAt);
    const sy = ym(A + 10 * (stumpAt + 1));
    px('stump', sw / 2 - 10, sy - 18, 132, 24);
    if (!(onStump && stumpAt === 1)) px('cable-hang', sw / 2 + 108, sy + 4, 2, 64);
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
