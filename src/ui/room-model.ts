// Комната в разрезе: здание в слоте → список деталей, как buildTower для башни.
// Чистая функция без DOM: room.ts кладёт детали div-ами в <div class="tw rm">. Детали — те же
// классы .tw .* из design/project/sedmaya.css (ядро, растения, лампы, жители) и свои .rm-* из
// room.css (стены, мебель, настроения). Числа здесь — геометрия картинки, а не баланс.
//
// Сцена ROOM_W × ROOM_H: потолок сверху, пол снизу, задняя стена с окнами наружу (в окнах небо
// или Мгла). Жители рисуются по настоящему числу рабочих или жильцов, настроение комнаты
// (Мгла, иней, темнота, голод, болезнь, беспорядок, праздник) — слоями поверх.
import type { RoomAct, RoomInfo, RoomMood } from '../core';
import { hash01, type Part } from '../scenes/tower-model';

export const ROOM_W = 400;
export const ROOM_H = 240;
const FLOOR = 208;
const CEIL = 16;
/** Житель в комнате: вдвое крупнее, чем на башне (9×22). Сидящий — в профиль, лежащий — боком. */
const MAN_W = 18;
const MAN_H = 44;
const SIT_W = 22;
const SIT_H = 36;
const CLOTH = ['#9A3335', '#255D6B', '#A26943', '#255D6B', '#AE5700'];
const SKIN = ['#E2B48C', '#D59F7A', '#EBC5A0', '#C98F6A'];
const HAIR = ['#2B241F', '#5C3E2A', '#8E6D57', '#C9BFAE', '#2B241F'];
const SCARF = ['#C93C41', '#AE5700', '#255D6B', '#E6D7B4'];
const BLANKET = ['#C77A45', '#E6D7B4', '#8EABAE', '#DEB399'];
const WALL: Record<string, string> = {
  housing: '#B99A80',
  farm: '#6E8A7E',
  catcher: '#7F6A5A',
  core: '#3E5559',
  council: '#8E3B3C',
  infirmary: '#D8D0BE',
  guard: '#55706F',
  scrap: '#6B6458',
  corner: '#9A4A42',
  radio: '#5E7779',
  observatory: '#3C5056',
};
const ALIAS: Record<string, string> = { salvage: 'scrap', red_corner: 'corner' };

export interface RoomInput {
  /** id здания из данных. */
  b: string;
  stage: 1 | 2 | 3;
  /** Работают сейчас (или живут — у жилого модуля). */
  people: number;
  moods: readonly RoomMood[];
  /** Эфир 0..1: яркость ламп и ядра. */
  ether: number;
  health: number;
  solidarity: number;
  /** Председатель сегодня зашёл сюда: стоит в комнате. */
  visited: boolean;
  /** Номер комнаты для разброса деталей: одна комната всегда выглядит одинаково. */
  seed: number;
}

/**
 * Часть тела жителя: прямоугольник в координатах родителя (фигуры или другой части). r — поза,
 * поворот в градусах (CSS transform), o — ось поворота; живое движение CSS ведёт отдельными
 * свойствами rotate/translate/scale, поэтому поза и анимация не мешают друг другу.
 */
export interface Limb {
  c: string;
  x: number;
  y: number;
  w: number;
  h: number;
  o?: string;
  r?: number;
  t?: string;
  kids?: Limb[];
}

/** Житель: поза, подпись для кнопки и части тела. tap — на него можно нажать (Председатель — нет). */
export interface RoomFigure {
  i: number;
  act: RoomAct;
  label: string;
  tap: boolean;
  body: Limb[];
}

export interface RoomPart extends Part {
  fig?: RoomFigure;
}

export interface RoomModel {
  parts: RoomPart[];
  /** Сколько жителей нарисовано (без Председателя). */
  figures: number;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const r1 = (v: number) => Math.round(v * 10) / 10;
const op = (v: number) => `opacity:${v.toFixed(2)};`;

/** Вход картинки из сведений о комнате и состояния. */
export function roomInputFromInfo(
  info: RoomInfo,
  state: { stats: { health: number; solidarity: number } },
  ether: number,
): RoomInput {
  let people = info.workers?.have ?? info.residents?.live ?? 0;
  // В Ядре и Совете своих рабочих нет, но там всегда кто-то на вахте
  if (info.id === 'core') people = 2;
  if (info.id === 'council') people = 3;
  return {
    b: info.id,
    stage: info.stage,
    people: info.abandoned ? 0 : people,
    moods: info.moods,
    ether,
    health: state.stats.health,
    solidarity: state.stats.solidarity,
    visited: info.visit.here,
    seed: info.tier * 3 + info.slot + 1,
  };
}

export function buildRoom(s: RoomInput): RoomModel {
  const parts: RoomPart[] = [];
  const counts = new Map<string, number>();
  const b = ALIAS[s.b] ?? s.b;
  const S = s.stage;
  const has = (m: RoomMood) => s.moods.includes(m);
  const e = clamp(s.ether, 0, 1);
  const dark = has('dark');
  const hiSol = s.solidarity >= 70;
  const seed = s.seed * 37;
  let figIdx = 0;

  function P(
    c: string,
    x: number,
    y: number,
    w: number,
    h: number,
    extra = '',
    t = '',
    fig?: RoomFigure,
  ): void {
    const base = c.split(' ', 1)[0] ?? c;
    const nth = (counts.get(base) ?? 0) + 1;
    counts.set(base, nth);
    const p: RoomPart = { k: `${base}#${nth}`, c, x: r1(x), y: r1(y), w: r1(w), h: r1(h), s: extra, t };
    if (fig) p.fig = fig;
    parts.push(p);
  }
  /**
   * Житель: x — центр, yb — где стоят ноги (у лежащего — низ одеяла). act — поза: work, walk, sit,
   * lie, talk. opt.face −1 — сидит лицом влево; opt.idle — чем занят сидящий; opt.phones — наушники.
   */
  function man(x: number, yb: number, act: RoomAct = 'work', cls = '', opt: ManOpt = {}): void {
    const i = figIdx++;
    const h = (k: number) => hash01(seed + i * 13 + k);
    const pick = <T>(list: readonly T[], k: number): T => list[Math.floor(h(k) * list.length)] as T;
    const col = hiSol ? pick(CLOTH, 31) : '#1A3437';
    const look: Look = {
      hat: cls === 'medic' ? 'medcap' : cls === 'guard' ? 'cap' : act === 'lie' ? 'hair' : pick(HATS, 5),
      idle: opt.idle ?? (act === 'sit' ? pick(SIT_IDLE, 7) : ''),
      phones: !!opt.phones,
    };
    const vars =
      `--cc:${cls === 'medic' ? '#FBF0D6' : cls === 'guard' ? '#255D6B' : col};--pt:${hiSol ? '#2C4649' : '#0F2427'};` +
      `--sk:${pick(SKIN, 3)};--hr:${pick(HAIR, 9)};--sc:${pick(SCARF, 11)};--bl:${pick(BLANKET, 17)};` +
      `--dl:-${(h(0) * 4).toFixed(1)}s;`;
    const what = [act, cls, look.idle ? `do-${look.idle}` : '', look.hat === 'scarf' ? 'she' : '']
      .filter(Boolean)
      .join(' ');
    const fig: RoomFigure = {
      i,
      act,
      label: figLabel(b, act, cls, look.hat === 'scarf'),
      tap: true,
      body: body(act, look),
    };
    if (act === 'lie') {
      P(`rm-man ${what}`, x - MAN_H / 2, yb - LIE_H, MAN_H, LIE_H, vars, '', fig);
      return;
    }
    const face = (opt.face ?? 1) < 0 ? 'scale:-1 1;' : '';
    if (act === 'sit') P(`rm-man ${what}`, x - SIT_W / 2, yb - SIT_H, SIT_W, SIT_H, vars + face, '', fig);
    else P(`rm-man ${what}`, x - MAN_W / 2, yb - MAN_H, MAN_W, MAN_H, vars, '', fig);
  }

  // Комната: стена, окна наружу, потолок, пол
  P(`rm-wall s${S}`, 0, 0, ROOM_W, FLOOR, `--bc:${WALL[b] ?? '#8E7A6A'};`);
  const view = `rm-view${has('mist') ? ' mist' : ''}${has('frost') ? ' frost' : ''}`;
  const windows: [number, number][] =
    b === 'core' || b === 'observatory'
      ? []
      : b === 'housing'
        ? [[160, 48]]
        : [
            [24, 46],
            [ROOM_W - 82, 46],
          ];
  for (const [wx, wy] of windows) {
    P(view, wx, wy, 58, 56);
    if (has('unrest') && hash01(seed + wx) > 0.4) P('rm-boards', wx - 4, wy + 14, 66, 30);
  }

  // Мебель и работа — по зданию
  const workers = Math.min(s.people, 6);
  if (b === 'housing') {
    P(`rm-bunk s${S}`, 14, 74, 104, 134);
    const sleepers = Math.min(2, Math.max(0, workers - 4));
    for (let i = 0; i < sleepers; i++) man(66, 110 + i * 62, 'lie');
    P('laundry', 136, 36, 130, 13);
    // У торцов стола сидят друг против друга, у печки греются, остальные ходят
    const seats = [147, 269];
    for (let i = 0; i < Math.min(2, workers); i++)
      man(seats[i] ?? 200, FLOOR - 4, 'sit', '', { face: i ? -1 : 1, idle: i ? 'nod' : 'drink' });
    P(`rm-table s${S}`, 160, FLOOR - 34, 96, 34);
    const bowls = has('hungry') ? ' empty' : '';
    for (const bx of [176, 204, 232]) P(`rm-bowl${bowls}`, bx - 7, FLOOR - 40, 14, 6);
    P(`rm-stove s${S}`, 300, FLOOR - 62, 46, 62);
    P('rm-fire', 312, FLOOR - 34, 22, 16, op(has('hungry') ? 0.35 : 1));
    P('rm-pipe', 316, CEIL, 12, FLOOR - 62 - CEIL);
    if (workers > 2) man(286, FLOOR, 'talk');
    if (workers > 3) man(372, FLOOR, 'walk', '');
  } else if (b === 'farm') {
    const dry = has('mist') || has('sick') || s.health < 35 ? ' dry' : '';
    for (const rx of [30, 156, 282]) {
      P('lamp-cone', rx - 6, CEIL + 14, 100, 150, op(S >= 2 ? 1 : 0.6));
      P('growlamp', rx + 26, CEIL + 10, 36, 8);
      P(`rm-rack s${S}`, rx, 56, 88, FLOOR - 56);
      for (const sy of [60, 110]) {
        P(`plant tall f${S}${dry}`, rx + 6, sy, 76, 34);
        P(`plant leafy${dry}`, rx + 4, sy + 30, 80, 16);
      }
      P(`trough f${S}${dry}`, rx + 2, 160, 84, 10);
    }
    const spots = [128, 254, 20, 380, 190, 70];
    for (let i = 0; i < workers; i++) man(spots[i] ?? 200, FLOOR, i < 3 ? 'work' : 'walk');
    if (S === 1) P('barrel', 360, FLOOR - 30, 22, 30);
  } else if (b === 'catcher') {
    P(`rm-funnel s${S}`, 140, CEIL - 2, 120, 46);
    P('ether-flow', 196, CEIL + 40, 8, 74, op(0.2 + 0.8 * e));
    P(`rm-tank s${S}`, 160, 112, 80, FLOOR - 112);
    P('rm-tank-fill', 166, 118 + (1 - e) * (FLOOR - 124), 68, (FLOOR - 124) * e + 1, op(0.4 + 0.6 * e));
    P('gauge', 112, 120, 26, 26);
    P('gauge', 262, 120, 26, 26);
    P(`rm-wheel s${S}`, 278, 150, 34, 34);
    P('rm-pipes', 0, 176, 160, 12);
    P('rm-pipes', 240, 176, 160, 12);
    const spots = [116, 304, 70, 350];
    for (let i = 0; i < Math.min(workers, spots.length); i++)
      man(spots[i] ?? 0, FLOOR, i < 2 ? 'work' : 'walk');
  } else if (b === 'core') {
    const d = 120;
    const cx = ROOM_W / 2;
    const cy = 106;
    const R = d / 2;
    const cs = ` c${S}`;
    P('core-halo', cx - d, cy - d * 0.65, d * 2, d * 1.3, op((0.15 + 0.85 * e) * (dark ? 0.6 : 1)));
    P(`core-conduit${cs}`, cx - 7, 0, 14, cy - R + 6);
    P('core-flow', cx - 2.5, 0, 5, cy - R + 4, op(0.15 + 0.85 * e));
    P(`core-ring eq back${cs}`, cx - R - 22, cy - 18, d + 44, 36);
    P(`core${cs}`, cx - R, cy - R, d, d, op(0.35 + 0.65 * e));
    P('core-swirl', cx - d * 0.41, cy - d * 0.41, d * 0.82, d * 0.82, op(0.2 + 0.8 * e));
    P('core-swirl rev', cx - d * 0.41, cy - d * 0.41, d * 0.82, d * 0.82, op(0.15 + 0.7 * e));
    P('core-heart', cx - d * 0.2, cy - d * 0.17, d * 0.4, d * 0.4, op(0.3 + 0.7 * e));
    P(`core-ring eq front${cs}`, cx - R - 22, cy - 18, d + 44, 36);
    P(`core-base b${S}`, cx - 46, cy + R - 6, 92, FLOOR - (cy + R - 6));
    P('rm-panel', 18, 70, 76, 70);
    for (const [gx, gy] of [
      [26, 80],
      [58, 80],
      [26, 108],
    ] as const)
      P('gauge', gx, gy, 24, 24);
    P('rm-catwalk', 0, 150, 120, 10);
    P('rm-catwalk', 280, 150, 120, 10);
    P('rm-crates', 312, FLOOR - 34, 70, 34);
    P('crystal', 330, FLOOR - 52, 14, 20);
    P('crystal', 352, FLOOR - 48, 12, 16);
    man(70, 150, 'work');
    man(300, FLOOR, 'walk');
  } else if (b === 'council') {
    P(`rm-banner s${S}`, 140, 26, 120, 76);
    P('star rm-star', 182, 38, 36, 36);
    P('rm-map', 34, 40, 84, 64);
    P('rm-map', ROOM_W - 118, 40, 84, 64);
    for (let i = 0; i < Math.min(3, workers); i++)
      man(150 + i * 50, FLOOR - 30, 'sit', '', { face: i === 2 ? -1 : 1, idle: i === 1 ? 'nod' : 'read' });
    P(`rm-desk s${S}`, 110, FLOOR - 40, 180, 40);
    P('rm-papers', 132, FLOOR - 46, 38, 8);
    P('rm-papers', 226, FLOOR - 46, 30, 8);
    P('rm-lampdesk', 196, FLOOR - 62, 14, 22);
  } else if (b === 'infirmary') {
    const ill = has('sick') ? 3 : s.health < 50 ? 2 : 1;
    for (let i = 0; i < 3; i++) {
      const bx = 18 + i * 92;
      if (i < ill) man(bx + 38, FLOOR - 32, 'lie', 'patient');
      P(`rm-bed s${S}`, bx, FLOOR - 34, 80, 34);
    }
    P('rm-drip', 100, FLOOR - 96, 14, 96);
    P('rm-cabinet', 306, 70, 76, FLOOR - 70);
    P('rm-cross', 330, 90, 28, 28);
    for (let i = 0; i < Math.min(2, workers); i++) man(280 - i * 180, FLOOR, i ? 'walk' : 'work', 'medic');
  } else if (b === 'guard') {
    P('rm-map', 140, 30, 120, 76);
    P('star rm-star', 186, 40, 28, 28);
    P(`rm-rack-tools s${S}`, 300, 70, 76, 110);
    P('rm-console', 20, FLOOR - 56, 110, 56);
    P(`lamp${S === 3 ? ' ether' : ''}`, 64, FLOOR - 74, 20, 20, op(has('unrest') ? 0.5 : 1));
    for (let i = 0; i < Math.min(3, workers); i++) man(176 + i * 56, FLOOR, i ? 'walk' : 'work', 'guard');
  } else if (b === 'scrap') {
    P('hookline', 300, 0, 3, 96);
    P('hook', 293, 96, 18, 16);
    P('sheet', 286, 112, 30, 40, 'transform:rotate(-8deg);');
    P('b-pile', 210, FLOOR - 52, 180, 52);
    P('gear', 238, FLOOR - 70, 30, 30);
    P('barrel', 356, FLOOR - 40, 24, 40);
    P(`rm-bench s${S}`, 24, FLOOR - 40, 140, 40);
    P('rm-vise', 120, FLOOR - 58, 26, 18);
    if (workers) P('rm-sparks', 72, FLOOR - 78, 40, 36);
    for (let i = 0; i < Math.min(3, workers); i++) man(60 + i * 72, FLOOR, i === 2 ? 'walk' : 'work');
  } else if (b === 'corner') {
    P('poster', 30, 30, 70, 100);
    P('poster', ROOM_W - 100, 30, 70, 100);
    P('star rm-star', 182, 30, 36, 36);
    P(`table t${S}`, 150, FLOOR - 32, 100, 32);
    P('rm-samovar', 186, FLOOR - 66, 28, 34);
    P('rm-gramo', 120, FLOOR - 50, 28, 50);
    const guests = Math.min(5, workers + (has('festive') ? 3 : 1));
    for (let i = 0; i < guests; i++)
      if (i % 2) man(40 + i * 80, FLOOR, 'talk');
      else man(40 + i * 80, FLOOR - 4, 'sit', '', { face: i === 4 ? -1 : 1, idle: i ? 'swing' : 'drink' });
    P('rm-benches', 0, FLOOR - 18, ROOM_W, 18);
  } else if (b === 'radio') {
    P('ring wave', 300, 30, 70, 70, op(0.35 + 0.65 * e));
    P('ring wave', 300, 30, 70, 70, `${op(0.35 + 0.65 * e)}animation-delay:-1.2s;`);
    P('rm-speaker', 316, 50, 38, 34);
    P('rm-wires', 0, CEIL, ROOM_W, 30);
    if (workers) man(292, FLOOR - 2, 'sit', '', { face: -1, idle: 'nod', phones: true });
    P('rm-console', 40, FLOOR - 56, 230, 56);
    P('rm-lights', 60, FLOOR - 50, 180, 14, dark ? 'animation-duration:.6s;' : '');
  } else if (b === 'observatory') {
    P('rm-slit', 150, 0, 100, 60);
    P('rm-scope', 186, 30, 26, 150, 'transform:rotate(28deg);transform-origin:50% 100%;');
    P('rm-mount', 172, FLOOR - 40, 54, 40);
    P('rm-chart', 26, 40, 100, 90);
    P('rm-desk s1', 270, FLOOR - 36, 110, 36);
    if (workers) man(250, FLOOR, 'work');
  } else {
    P('rm-crates', 60, FLOOR - 40, 120, 40);
    for (let i = 0; i < Math.min(3, workers); i++) man(220 + i * 50, FLOOR, 'work');
  }

  // Председатель зашёл: красная фигура у двери, жители к нему повернулись
  if (s.visited) {
    const look: Look = { hat: 'cap', idle: '', phones: false };
    const chair: RoomFigure = {
      i: -1,
      act: 'work',
      label: 'Председатель',
      tap: false,
      body: body('work', look),
    };
    const vars = '--cc:#C93C41;--pt:#2B241F;--sk:#E2B48C;--hr:#2B241F;';
    P('rm-man rm-chair', ROOM_W - 40, FLOOR - MAN_H, MAN_W, MAN_H, vars, '', chair);
  }

  // Потолок, лампа и пол
  P(`rm-ceil s${S}`, 0, 0, ROOM_W, CEIL);
  if (b !== 'core' && b !== 'farm') {
    P('rm-cord', ROOM_W / 2 - 1, CEIL, 2, 18);
    P(`rm-bulb${dark ? ' flicker' : ''}`, ROOM_W / 2 - 9, CEIL + 16, 18, 12);
    P(
      `rm-light${dark ? ' flicker' : ''}`,
      ROOM_W / 2 - 110,
      CEIL + 24,
      220,
      FLOOR - CEIL - 24,
      op(0.25 + 0.6 * e),
    );
  }
  P(`rm-floor s${S}`, 0, FLOOR, ROOM_W, ROOM_H - FLOOR);

  // Настроение — слоями поверх
  if (has('festive')) P('garland', 20, CEIL + 4, ROOM_W - 40, 16);
  if (has('unrest')) P('rm-scrawl', 130, 120, 90, 30, '', 'ВСЁ ОБЩЕЕ?');
  if (has('mist')) {
    P('rm-mist', -40, FLOOR - 70, ROOM_W + 80, 110);
    P('rm-mist m1', -60, FLOOR - 40, ROOM_W + 120, 90);
  }
  if (has('frost')) P('rm-frost', 0, 0, ROOM_W, ROOM_H);
  if (dark) P('rm-dim', 0, 0, ROOM_W, ROOM_H);
  if (s.people === 0 && b !== 'core' && b !== 'council') P('rm-dust', 0, 0, ROOM_W, ROOM_H);

  return { parts, figures: figIdx };
}

/** Цвет стены здания: им же закрашен фасад, который уезжает при открытии окна. */
export function roomWall(b: string): string {
  return WALL[ALIAS[b] ?? b] ?? '#8E7A6A';
}

// ---- Фигура жителя ----

type Hat = 'cap' | 'scarf' | 'hair' | 'bald' | 'medcap';
const HATS: readonly Hat[] = ['cap', 'scarf', 'hair', 'scarf', 'hair', 'bald'];
/** Чем занят сидящий: пьёт из кружки, листает бумаги, клюёт носом, болтает ногой. */
type SitIdle = 'drink' | 'read' | 'nod' | 'swing';
const SIT_IDLE: readonly SitIdle[] = ['drink', 'read', 'nod', 'swing'];
const LIE_H = 18;

interface ManOpt {
  face?: number;
  idle?: SitIdle;
  phones?: boolean;
}
interface Look {
  hat: Hat;
  idle: SitIdle | '';
  phones: boolean;
}

const WHO: Record<string, string> = {
  housing: 'Жилец',
  farm: 'Работник фермы',
  catcher: 'Слесарь уловителя',
  core: 'Кочегар',
  council: 'Член Совета',
  infirmary: 'Больной',
  guard: 'Постовой',
  scrap: 'Сварщик',
  corner: 'Гость красного уголка',
  radio: 'Радист',
  observatory: 'Наблюдатель',
};
const DOING: Record<RoomAct, string> = {
  work: 'работает',
  walk: 'идёт',
  sit: 'сидит',
  lie: 'спит',
  talk: 'разговаривает',
};

/** Подпись кнопки жителя: «Жилец, спит». */
function figLabel(b: string, act: RoomAct, cls: string, she: boolean): string {
  if (cls === 'medic') return `${she ? 'Санитарка' : 'Санитар'}, ${DOING[act]}`;
  if (b === 'infirmary' && act === 'lie') return `${she ? 'Больная' : 'Больной'}, лежит`;
  if (b === 'housing') return `${she ? 'Жительница' : 'Жилец'}, ${DOING[act]}`;
  return `${WHO[b] ?? 'Житель'}, ${DOING[act]}`;
}

const L = (c: string, x: number, y: number, w: number, h: number, more: Partial<Limb> = {}): Limb => ({
  c,
  x,
  y,
  w,
  h,
  ...more,
});

function hat(look: Look, side: boolean): Limb[] {
  const s = side ? ' side' : '';
  if (look.hat === 'cap') return [L(`rm-hat cap${s}`, -1, -1, 10, 4)];
  if (look.hat === 'medcap') return [L('rm-hat medcap', 0, -1.5, 8, 4)];
  if (look.hat === 'scarf') return [L(`rm-hat scarf${s}`, -1, -1, 10, 8.5)];
  if (look.hat === 'hair') return [L(`rm-hat hair${s}`, 0, -0.5, 8, 3.5)];
  return [];
}

/** Рука: плечо и предплечье с кистью; r — поза плеча, fr — локтя. */
function arm(side: 'b' | 'f', x: number, y: number, r = 0, fr = 0, hand: Limb[] = []): Limb {
  return L(`rm-arm ${side}`, x, y, 3.6, 8, {
    o: '50% 20%',
    r,
    kids: [L('rm-fore', 0, 6.6, 3.6, 8.4, { o: '50% 10%', r: fr, kids: hand.length ? hand : undefined })],
  });
}

/** Нога: бедро и голень с ботинком; r — поза бедра, sr — колена. */
function leg(side: 'b' | 'f', x: number, y: number, r = 0, sr = 0, foot = false): Limb {
  const shin = L('rm-shin', 0, 9, 4.6, foot ? 10.5 : 9.5, {
    o: '50% 0',
    r: sr,
    kids: foot ? [L('rm-foot', 0, 8.6, 6.6, 2.4)] : undefined,
  });
  return L(`rm-leg ${side}`, x, y, 4.6, 10, { o: '50% 0', r, kids: [shin] });
}

const SIT_POSE: Record<SitIdle, [number, number]> = {
  drink: [-25, -75],
  read: [-55, -55],
  nod: [-10, -60],
  swing: [-5, -40],
};
const STAND_POSE: Partial<Record<RoomAct, [number, number, number, number]>> = {
  work: [-30, -50, 8, -10],
  talk: [-20, -60, 10, -20],
  walk: [0, -10, 6, -6],
};

/** Части тела по позе; координаты — от левого верхнего угла рамки фигуры. */
function body(act: RoomAct, look: Look): Limb[] {
  if (act === 'lie')
    return [
      L('rm-pillow', 0, 8, 14, 9.5),
      L('rm-head sleep', 2.5, 2.8, 9.5, 9, { o: '70% 80%' }),
      L('rm-blanket', 10, 4.5, 34, 13.5, {
        o: '50% 100%',
        kids: [L('rm-sleeve', 3, 3, 14, 3.6)],
      }),
      L('rm-z', 8, -4, 6, 8, { t: 'z' }),
      L('rm-z z2', 8, -4, 6, 8, { t: 'z' }),
      L('rm-z z3', 8, -4, 6, 8, { t: 'z' }),
    ];
  if (act === 'sit') {
    // В профиль, лицом вправо: табурет, бедро вперёд, голень вниз, руки по занятию
    const [ar, fr] = SIT_POSE[look.idle || 'nod'];
    const hand = look.idle === 'drink' ? [L('rm-mug', -1.4, 6, 6, 5)] : [];
    const head = L('rm-head side', 5, 0, 8, 9, { o: '40% 95%', kids: hat(look, true) });
    if (look.phones) head.kids = [...(head.kids ?? []), L('rm-phones', -1.5, -1.5, 11, 8)];
    const parts = [
      L('rm-stool', 2, 25, 13, 11),
      leg('b', 4.2, 21.5, -90, 90, true),
      arm('b', 5.2, 9.5, ar + 10, fr),
      L('rm-torso side', 4, 8, 9.5, 16.5),
      head,
      leg('f', 5.7, 22.4, -90, 90, true),
      arm('f', 7, 9.5, ar, fr, hand),
    ];
    if (look.idle === 'read')
      parts.push(L('rm-paper', 13, 6, 8, 11, { kids: [L('rm-page', 0, 0, 8, 11, { o: '0 50%' })] }));
    return parts;
  }
  // Стоя, лицом к нам
  const [fa, ff, ba, bf] = STAND_POSE[act] ?? [0, 0, 0, 0];
  return [
    leg('b', 4.2, 25.5),
    leg('f', 9.2, 25.5),
    arm('b', 1, 10.5, ba, bf),
    L('rm-torso', 3, 9.5, 12, 17.5),
    L('rm-head', 5, 0, 8, 9.5, { o: '50% 95%', kids: hat(look, false) }),
    arm('f', 13.4, 10.5, fa, ff),
  ];
}
