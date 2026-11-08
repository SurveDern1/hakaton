// Общие подписи интерфейса: даты календаря, названия ресурсов и показателей, описание зданий и декретов.
import type { BuildingDef, DecreeDef, Effects, FactionDelta, GameData } from '../core';

export const RES_NAMES: Record<string, string> = {
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
};

/** Родительный падеж для «+7 еды». */
const GENITIVE: Record<string, string> = {
  pop: 'жителей',
  food: 'еды',
  ether: 'эфира',
  mat: 'материалов',
  trust: 'доверия',
  solidarity: 'солидарности',
  health: 'здоровья',
  order: 'порядка',
  altitude: 'высоты',
  mist: 'Мглы',
};

export const FACTION_NAMES: Record<string, string> = {
  stokers: 'Кочегары',
  institute: 'Институт',
  mistborn: 'Туманники',
  sky: 'Дети Неба',
};

export const TIER_NAMES = { root: 'Корень', spire: 'Шпиль' } as const;

/** Дата дня игры. */
export function dayDate(data: GameData, day: number): Date {
  const date = new Date(`${data.balance.calendar.firstDay}T00:00:00`);
  date.setDate(date.getDate() + day - 1);
  return date;
}

export const fmtDate = (d: Date, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }) =>
  d.toLocaleDateString('ru-RU', opts);

export const fmtNum = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 1 });

/** Минус как в макетах («−&#8201;7»): настоящий минус U+2212 и узкий неразрывный пробел, чтобы не путать с дефисом. */
export const MINUS = '− ';

/** «+2», «− 1», «± 0». */
export const sgn = (n: number) =>
  n > 0 ? `+${fmtNum(n)}` : n < 0 ? `${MINUS}${fmtNum(-n)}` : `± ${fmtNum(0)}`;

/** «Ярус 2» по номеру среди обычных ярусов, «Корень», «Шпиль». */
export function tierName(kinds: readonly string[], i: number): string {
  const kind = kinds[i];
  if (kind === 'root' || kind === 'spire') return TIER_NAMES[kind];
  let n = 0;
  for (let j = 0; j <= i; j++) if (kinds[j] === 'tier') n++;
  return `Ярус ${n}`;
}

function effectsText(e: Effects | undefined): string[] {
  return Object.entries(e ?? {})
    .filter(([, v]) => v)
    .map(([k, v]) => `${sgn(v ?? 0)} ${GENITIVE[k] ?? k}`);
}

function factionsText(f: FactionDelta | undefined): string[] {
  return Object.entries(f ?? {})
    .filter(([, v]) => v)
    .map(([k, v]) => `${FACTION_NAMES[k] ?? k} ${sgn(v ?? 0)}`);
}

/** «+7 еды за ночь · 3 рабочих», «+6 мест жилья». */
export function buildingText(def: BuildingDef): string {
  const parts: string[] = [];
  if (def.housing) parts.push(`+${def.housing} мест жилья`);
  const per = effectsText(def.perNight);
  if (per.length) parts.push(`${per.join(', ')} за ночь`);
  if (def.rootBonus) parts.push(`в Корне +${Math.round(def.rootBonus * 100)}\u00a0%`);
  if (def.workers) parts.push(`${def.workers} рабоч.`);
  return parts.join(' · ');
}

/** «солидарность +2 · Институт −2 · еды +10 %». */
export function decreeText(def: DecreeDef): string {
  const parts = Object.entries(def.perNight ?? {})
    .filter(([, v]) => v)
    .map(([k, v]) => `${(RES_NAMES[k] ?? k).toLowerCase()} ${sgn(v ?? 0)}`);
  parts.push(...factionsText(def.factions));
  if (def.catcherFactor && def.catcherFactor !== 1)
    parts.push(`уловители ${sgn(Math.round((def.catcherFactor - 1) * 100))}\u00a0%`);
  if (def.foodFactor && def.foodFactor !== 1)
    parts.push(`еды едят ${sgn(Math.round((def.foodFactor - 1) * 100))}\u00a0%`);
  return parts.join(' · ');
}

/** «Ночей» в нужной форме: 1 ночь, 2 ночи, 5 ночей. */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

/** Части заголовка: знаки препинания сразу после буквы — отдельно, чтобы обернуть их в `.dp`. */
export function splitPunct(text: string): { text: string; punct: boolean }[] {
  return text
    .split(/(?<=[\p{L}\d»"')])([,.!?:;…]+)/u)
    .map((s, i) => ({ text: s, punct: i % 2 === 1 }))
    .filter((p) => p.text !== '');
}

/** Текст для `.disp`: в моноширинном Rubik Mono One запятая или «!» занимают клетку буквы
 *  и отъезжают от слова, `.dp` (sedmaya.css) прижимает их обратно. */
export function dispText(text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const part of splitPunct(text)) {
    if (!part.punct) {
      frag.append(part.text);
      continue;
    }
    const span = document.createElement('span');
    span.className = 'dp';
    span.textContent = part.text;
    frag.append(span);
  }
  return frag;
}

type Child = Node | string | null | undefined | false;

/** Короткая сборка разметки без шаблонов: атрибуты и дети. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) if (c) node.append(c);
  return node;
}

/** Иконки шапки (как в Main.dc.html): 24×24, обводка. */
export const ICONS: Record<string, string> = {
  pop: '<circle cx="12" cy="7" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
  food: '<path d="M3 11h18a9 9 0 0 1-18 0z"/><path d="M8 7c0-2 2-2 2-4M13 7c0-2 2-2 2-4"/>',
  ether: '<path d="M12 2l6 7-6 13-6-13z"/><path d="M6 9h12"/>',
  mat: '<path d="M3 6h18M3 18h18M6 6l6 12 6-12"/>',
  altitude: '<path d="M12 20V4M6 10l6-6 6 6"/><path d="M4 21h16"/>',
  mist: '<path d="M3 9c3-2 6 2 9 0s6-2 9 0M3 14c3-2 6 2 9 0s6-2 9 0M3 19c3-2 6 2 9 0s6-2 9 0"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  // Кнопка звука в шапке (src/audio/index.ts → hudButton): динамик и динамик перечёркнутый
  sound:
    '<path d="M4 9.5v5h3.5L12 18V6L7.5 9.5z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  soundOff: '<path d="M4 9.5v5h3.5L12 18V6L7.5 9.5z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
};

export function icon(name: string, size = 22, extra = ''): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true" ${extra}>${ICONS[name] ?? ''}</svg>`;
}

/** «Нужно 15 материалов» из core показывается как дефицит, в духе времени; остальные причины — как есть. */
export const deficitText = (why: string) => why.replace(/^Нужно (\d+) материалов$/, 'Дефицит: нужно $1 мат.');
