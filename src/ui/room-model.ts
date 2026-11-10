// Комната в разрезе: здание в слоте → список деталей, как buildTower для башни.
// Чистая функция без DOM: room.ts кладёт детали div-ами в <div class="tw rm">. Детали — те же
// классы .tw .* из design/project/sedmaya.css (ядро, растения, лампы, жители) и свои .rm-* из
// room.css (стены, мебель, настроения). Числа здесь — геометрия картинки, а не баланс.
//
// Сцена ROOM_W × ROOM_H: потолок сверху, пол снизу, задняя стена с окнами наружу (в окнах небо
// или Мгла). Жители рисуются по настоящему числу рабочих или жильцов, настроение комнаты
// (Мгла, иней, темнота, голод, болезнь, беспорядок, праздник) — слоями поверх.
import type { RoomInfo, RoomMood } from '../core';
import { hash01, type Part } from '../scenes/tower-model';

export const ROOM_W = 400;
export const ROOM_H = 240;
const FLOOR = 208;
const CEIL = 16;
/** Житель в комнате: вдвое крупнее, чем на башне (9×22). */
const MAN_W = 18;
const MAN_H = 44;
const CLOTH = ['#9A3335', '#255D6B', '#A26943', '#255D6B', '#AE5700'];
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

export interface RoomModel {
  parts: Part[];
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
  const parts: Part[] = [];
  const counts = new Map<string, number>();
  const b = ALIAS[s.b] ?? s.b;
  const S = s.stage;
  const has = (m: RoomMood) => s.moods.includes(m);
  const e = clamp(s.ether, 0, 1);
  const dark = has('dark');
  const hiSol = s.solidarity >= 70;
  const seed = s.seed * 37;
  let figIdx = 0;

  function P(c: string, x: number, y: number, w: number, h: number, extra = '', t = ''): void {
    const base = c.split(' ', 1)[0] ?? c;
    const nth = (counts.get(base) ?? 0) + 1;
    counts.set(base, nth);
    parts.push({ k: `${base}#${nth}`, c, x: r1(x), y: r1(y), w: r1(w), h: r1(h), s: extra, t });
  }
  /** Житель: x — центр, yb — где стоят ноги. act — поза: work, walk, sit, lie, talk. */
  function man(x: number, yb: number, act = 'work', cls = ''): void {
    const i = figIdx++;
    const col = hiSol ? CLOTH[Math.floor(hash01(seed + i + 31) * CLOTH.length)] : '#1A3437';
    const delay = `animation-delay:-${(hash01(seed + i) * 4).toFixed(1)}s;`;
    if (act === 'lie') {
      P(`man rm-man lie${cls ? ` ${cls}` : ''}`, x - MAN_H / 2, yb - MAN_W, MAN_H, MAN_W, `--cc:${col};`);
      return;
    }
    const h = act === 'sit' ? MAN_H * 0.8 : MAN_H;
    P(`man rm-man ${act}${cls ? ` ${cls}` : ''}`, x - MAN_W / 2, yb - h, MAN_W, h, `--cc:${col};${delay}`);
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
    // За столом сидят, у печки греются, остальные ходят
    const seats = [176, 236];
    for (let i = 0; i < Math.min(2, workers); i++) man(seats[i] ?? 200, FLOOR - 4, 'sit');
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
    for (let i = 0; i < Math.min(3, workers); i++) man(150 + i * 50, FLOOR - 6, 'sit');
    P(`rm-desk s${S}`, 110, FLOOR - 40, 180, 40);
    P('rm-papers', 132, FLOOR - 46, 38, 8);
    P('rm-papers', 226, FLOOR - 46, 30, 8);
    P('rm-lampdesk', 196, FLOOR - 62, 14, 22);
  } else if (b === 'infirmary') {
    const ill = has('sick') ? 3 : s.health < 50 ? 2 : 1;
    for (let i = 0; i < 3; i++) {
      const bx = 18 + i * 92;
      if (i < ill) man(bx + 38, FLOOR - 32, 'lie');
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
    for (let i = 0; i < guests; i++) man(40 + i * 80, FLOOR, i % 2 ? 'talk' : 'sit');
    P('rm-benches', 0, FLOOR - 18, ROOM_W, 18);
  } else if (b === 'radio') {
    P('ring wave', 300, 30, 70, 70, op(0.35 + 0.65 * e));
    P('ring wave', 300, 30, 70, 70, `${op(0.35 + 0.65 * e)}animation-delay:-1.2s;`);
    P('rm-speaker', 316, 50, 38, 34);
    P('rm-wires', 0, CEIL, ROOM_W, 30);
    if (workers) {
      man(150, FLOOR - 4, 'sit');
      P('rm-phones', 150 - 11, FLOOR - 4 - MAN_H * 0.8 - 3, 22, 12);
    }
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
  if (s.visited)
    P('man rm-man rm-chair', ROOM_W - 40, FLOOR - MAN_H - 2, MAN_W + 2, MAN_H + 2, '--cc:#C93C41;');

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
