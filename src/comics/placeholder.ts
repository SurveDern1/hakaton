// Заглушки кадров, пока художник не нарисовал картинки: плакатные сцены в палитре игры на SVG.
// Сцена и тон задаются в data/comics.json полем art: { scene, tone }. Неизвестная сцена — пустое небо.
// Живые сцены (LIVE_SCENES) — готовые анимированные кадры, без пометки «эскиз».
import { fallScene } from './scene-fall';

const C = {
  ink: 'var(--ink)',
  ink2: 'var(--ink-2)',
  ink3: 'var(--ink-3)',
  line: 'var(--line)',
  paper: 'var(--paper)',
  paper2: 'var(--paper-2)',
  red: 'var(--red)',
  redDeep: 'var(--red-deep)',
  ochre: 'var(--ochre)',
  ether: 'var(--ether)',
  etherDeep: 'var(--ether-deep)',
  mist: 'var(--mist)',
  mistLight: 'var(--mist-light)',
};

const TONES: Record<string, [string, string]> = {
  dawn: [C.ochre, C.red],
  night: [C.ink, C.ink3],
  mist: [C.mistLight, C.mist],
  red: [C.red, C.redDeep],
};

/** Лучи конструктивистского солнца из точки (cx, cy). */
function rays(cx: number, cy: number, color: string, n = 14, opacity = 0.18): string {
  let s = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const b = a + Math.PI / n / 1.6;
    const r = 160;
    s += `<path d="M${cx} ${cy}L${cx + Math.cos(a) * r} ${cy + Math.sin(a) * r}L${cx + Math.cos(b) * r} ${cy + Math.sin(b) * r}Z"/>`;
  }
  return `<g fill="${color}" opacity="${opacity}">${s}</g>`;
}

/** Силуэт башни: ярусы, шпиль, звезда. (x — центр, y — низ, s — масштаб). */
function tower(x: number, y: number, s: number, body: string, star = C.red, windows = C.ochre): string {
  const tiers = [
    [22, 10],
    [18, 12],
    [14, 12],
    [10, 10],
  ];
  let top = y;
  let g = '';
  tiers.forEach(([w = 0, hgt = 0], i) => {
    top -= hgt * s;
    g += `<rect x="${x - (w * s) / 2}" y="${top}" width="${w * s}" height="${hgt * s}" fill="${body}"/>`;
    for (let k = -1; k <= 1; k++)
      g += `<rect x="${x + k * w * s * 0.25 - s}" y="${top + hgt * s * 0.35}" width="${2 * s}" height="${3 * s}" fill="${windows}" opacity="${i % 2 ? 0.9 : 0.6}"/>`;
  });
  g += `<path d="M${x - 2 * s} ${top}L${x} ${top - 16 * s}L${x + 2 * s} ${top}Z" fill="${body}"/>`;
  g += star5(x, top - 18 * s, 3.4 * s, star);
  // Корень — опрокинутый конус под нижним ярусом
  g += `<path d="M${x - 9 * s} ${y}L${x + 9 * s} ${y}L${x} ${y + 9 * s}Z" fill="${body}"/>`;
  return g;
}

function star5(cx: number, cy: number, r: number, fill: string): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.42 : r;
    pts.push(`${(cx + Math.cos(a) * rr).toFixed(2)},${(cy + Math.sin(a) * rr).toFixed(2)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="${fill}"/>`;
}

/** Волна тумана от высоты y до низа кадра. */
function mistBand(y: number, fill: string, opacity = 1, phase = 0): string {
  let d = `M-10 ${y}`;
  for (let x = -10; x <= 110; x += 10)
    d += ` Q${x + 5} ${y - 4 + Math.sin(x / 10 + phase) * 3} ${x + 10} ${y}`;
  d += ' L110 120 L-10 120 Z';
  return `<path d="${d}" fill="${fill}" opacity="${opacity}"/>`;
}

/** Ряд голов и плеч. */
function people(y: number, n: number, fill: string, size = 6, seed = 1): string {
  let g = '';
  for (let i = 0; i < n; i++) {
    const x = -4 + (i + 0.5) * (108 / n) + Math.sin(i * 7 + seed) * 2;
    const k = size * (0.85 + ((i * 37 + seed) % 5) * 0.06);
    g += `<circle cx="${x}" cy="${y - k * 1.6}" r="${k * 0.55}" fill="${fill}"/>`;
    g += `<path d="M${x - k} ${y + 30}L${x - k} ${y - k * 0.6}Q${x} ${y - k * 1.3} ${x + k} ${y - k * 0.6}L${x + k} ${y + 30}Z" fill="${fill}"/>`;
  }
  return g;
}

function crystal(cx: number, cy: number, r: number): string {
  return `
    <circle cx="${cx}" cy="${cy}" r="${r * 2.6}" fill="${C.ether}" opacity=".08"/>
    <circle cx="${cx}" cy="${cy}" r="${r * 1.7}" fill="${C.ether}" opacity=".14"/>
    <path d="M${cx} ${cy - r * 1.3}L${cx + r * 0.75} ${cy - r * 0.2}L${cx} ${cy + r * 1.3}L${cx - r * 0.75} ${cy - r * 0.2}Z" fill="${C.ether}"/>
    <path d="M${cx} ${cy - r * 1.3}L${cx + r * 0.75} ${cy - r * 0.2}L${cx} ${cy - r * 0.05}Z" fill="${C.paper}" opacity=".6"/>
    <path d="M${cx - r * 0.75} ${cy - r * 0.2}L${cx + r * 0.75} ${cy - r * 0.2}" stroke="${C.etherDeep}" stroke-width=".6"/>`;
}

const SCENES: Record<string, (fg: string) => string> = {
  city: () =>
    rays(50, 70, C.paper, 16, 0.22) +
    `<circle cx="50" cy="70" r="20" fill="${C.paper}" opacity=".85"/>` +
    [12, 26, 40, 50, 60, 74, 88]
      .map((x, i) => tower(x, 84 - (i === 3 ? 6 : 0), i === 3 ? 0.62 : 0.4 + (i % 3) * 0.05, C.ink))
      .join('') +
    `<rect x="-5" y="84" width="110" height="30" fill="${C.ink}"/>`,
  launch: () =>
    [18, 36, 64, 82]
      .map((x, i) => {
        const y = 40 + (i % 2) * 14;
        return `<path d="M${x - 3} ${y + 6}L${x} ${y + 50}L${x + 3} ${y + 6}Z" fill="${C.ochre}" opacity=".55"/>${tower(x, y, 0.38, C.ink2)}`;
      })
      .join('') +
    tower(50, 30, 0.5, C.paper2) +
    mistBand(78, C.mist, 0.9) +
    mistBand(86, C.mistLight, 1, 2),
  tower: () =>
    `<circle cx="72" cy="26" r="11" fill="${C.paper}" opacity=".25"/>` +
    `<ellipse cx="22" cy="40" rx="18" ry="4" fill="${C.paper}" opacity=".12"/>` +
    tower(50, 66, 0.95, C.ink2) +
    mistBand(80, C.mist, 0.85) +
    mistBand(88, C.mistLight, 0.95, 1.5),
  mist: () =>
    mistBand(30, C.mist, 0.5, 0.4) +
    mistBand(48, C.mistLight, 0.55, 1.3) +
    `<g fill="${C.ink}" opacity=".55"><ellipse cx="38" cy="52" rx="7" ry="2.6"/><ellipse cx="62" cy="52" rx="7" ry="2.6"/></g>` +
    `<g fill="${C.mistLight}"><circle cx="38" cy="52" r="1.6"/><circle cx="62" cy="52" r="1.6"/></g>` +
    mistBand(66, C.mist, 0.8, 2.2) +
    mistBand(82, C.mistLight, 0.95, 3.1),
  crowd: (fg) =>
    rays(50, 10, C.paper, 12, 0.14) +
    tower(50, 46, 0.5, fg, C.red) +
    people(80, 9, C.ink2, 7, 3) +
    people(94, 7, C.ink, 9, 5),
  core: () =>
    `<rect x="-5" y="78" width="110" height="30" fill="${C.ink}"/>` +
    `<path d="M20 78L30 40L70 40L80 78Z" fill="${C.ink2}" opacity=".7"/>` +
    crystal(50, 52, 14) +
    people(92, 3, C.ink, 8, 2),
  radio: () =>
    [10, 20, 30, 40]
      .map(
        (r) =>
          `<path d="M${50 - r} ${30 - r * 0.2}A${r} ${r} 0 0 1 ${50 + r} ${30 - r * 0.2}" fill="none" stroke="${C.ochre}" stroke-width="1.6" opacity="${1 - r / 50}"/>`,
      )
      .join('') +
    `<path d="M50 30L42 90M50 30L58 90M45 60L55 60M44 72L56 72" stroke="${C.paper2}" stroke-width="1.6" fill="none"/>` +
    `<circle cx="50" cy="30" r="2.4" fill="${C.red}"/>` +
    `<rect x="-5" y="88" width="110" height="20" fill="${C.ink}"/>`,
  harbor: () =>
    rays(50, 40, C.paper, 16, 0.2) +
    `<circle cx="50" cy="40" r="14" fill="${C.paper}" opacity=".7"/>` +
    `<path d="M14 58L36 54M40 54L60 54M64 54L86 58" stroke="${C.ink}" stroke-width="1.4"/>` +
    [14, 38, 62, 86].map((x, i) => tower(x, 66 - (i % 3) * 3, i === 1 ? 0.55 : 0.45, C.ink)).join('') +
    mistBand(84, C.mist, 0.9),
  grass: () =>
    rays(50, 46, C.paper, 18, 0.25) +
    `<circle cx="50" cy="46" r="18" fill="${C.paper}"/>` +
    `<rect x="-5" y="70" width="110" height="40" fill="${C.ochre}"/>` +
    Array.from(
      { length: 26 },
      (_, i) =>
        `<path d="M${i * 4 + 1} 100L${i * 4 + 2 + Math.sin(i) * 1.5} ${76 + (i % 4) * 2}L${i * 4 + 3} 100Z" fill="${C.redDeep}" opacity=".45"/>`,
    ).join('') +
    `<circle cx="50" cy="73" r="2.6" fill="${C.ink}"/><path d="M46 84Q50 74 54 84Z" fill="${C.ink}"/>`,
  schism: () =>
    tower(50, 36, 0.7, C.ink2) +
    `<path d="M40 40L47 54M60 40L53 54" stroke="${C.red}" stroke-width="1" stroke-dasharray="2 1.5"/>` +
    `<g transform="rotate(12 50 70)"><rect x="38" y="60" width="24" height="12" fill="${C.ink}"/>` +
    `<rect x="42" y="64" width="2" height="3" fill="${C.ochre}"/><rect x="49" y="64" width="2" height="3" fill="${C.ochre}"/><rect x="56" y="64" width="2" height="3" fill="${C.ochre}"/></g>` +
    mistBand(76, C.mist, 0.85) +
    mistBand(86, C.mistLight, 0.9, 1),
  fall: () =>
    mistBand(20, C.mist, 0.6) +
    `<circle cx="50" cy="38" r="6" fill="${C.ochre}" opacity=".25"/><circle cx="50" cy="38" r="1.6" fill="${C.ochre}"/>` +
    mistBand(40, C.mistLight, 0.7, 1) +
    mistBand(62, C.mist, 0.85, 2) +
    mistBand(80, C.mistLight, 1, 3),
  council: () =>
    `<rect x="-5" y="70" width="110" height="40" fill="${C.ink}"/>` +
    `<path d="M8 68L92 68L98 76L2 76Z" fill="${C.paper2}"/>` +
    people(70, 7, C.ink2, 6, 4) +
    [16, 38, 62, 84]
      .map(
        (x) =>
          `<rect x="${x - 1.2}" y="36" width="2.4" height="18" fill="${C.ink2}"/><circle cx="${x}" cy="35" r="2.4" fill="${C.ink2}"/>`,
      )
      .join('') +
    star5(50, 22, 7, C.paper),
};

export const PLACEHOLDER_SCENES = Object.keys(SCENES);

/** Готовые живые сцены: рисуются вместо заглушки той же сцены. */
const LIVE: Record<string, () => string> = { fall: fallScene };
export const LIVE_SCENES = Object.keys(LIVE);

/** Номер градиента: у каждой заглушки свой id внутри документа. */
let serial = 0;

/** SVG-заглушка кадра. */
export function placeholderArt(scene: string, tone = 'night'): string {
  const live = LIVE[scene];
  if (live) return live();
  const [a, b] = TONES[tone] ?? (TONES.night as [string, string]);
  serial += 1;
  const id = `cxg-${serial}`;
  const fg = tone === 'night' ? C.ink3 : C.ink2;
  const body = SCENES[scene]?.(fg) ?? '';
  return `<svg class="cx-svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
<rect x="-10" y="-10" width="120" height="120" fill="url(#${id})"/>${body}</svg>`;
}
