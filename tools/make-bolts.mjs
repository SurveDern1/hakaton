// Формы разрядов магнитных турбин (.tw .bolt в design/project/sedmaya.css).
// Запуск: node tools/make-bolts.mjs — печатает CSS-правила с SVG в data URI; их вставляют в sedmaya.css
// между отметками «bolts:begin» и «bolts:end» (или node tools/make-bolts.mjs --write).
// Канал — ломаная по смещению средней точки вокруг гладкой кривой между двумя «электродами», с ветками;
// три обводки (широкое свечение, ореол, белое ядро) и горячие точки на концах. Сид постоянный:
// формы те же при каждом запуске. Рамки (w × h) совпадают с px('bolt …') в tower-model.ts и Tower.dc.html.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Ломаная между a и b: середина уходит поперёк отрезка, разброс убывает с глубиной.
function split(a, b, disp, depth, rnd, out) {
  if (depth === 0) {
    out.push(b);
    return;
  }
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const off = (rnd() * 2 - 1) * disp;
  const m = [(a[0] + b[0]) / 2 + (-dy / len) * off, (a[1] + b[1]) / 2 + (dx / len) * off];
  split(a, m, disp * 0.56, depth - 1, rnd, out);
  split(m, b, disp * 0.56, depth - 1, rnd, out);
}

function jag(base, rough, depth, rnd) {
  const out = [base[0]];
  for (let i = 1; i < base.length; i++) {
    const len = Math.hypot(base[i][0] - base[i - 1][0], base[i][1] - base[i - 1][1]);
    split(base[i - 1], base[i], len * rough, depth, rnd, out);
  }
  return out;
}

// Гладкая основа: квадратичная кривая a → c → b, n точек
function curve(a, c, b, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  return pts;
}

const clampPts = (pts, w, h) => pts.map(([x, y]) => [Math.min(w - 1.5, Math.max(1.5, x)), Math.min(h - 1.5, Math.max(1.5, y))]);
const n = (v) => String(Math.round(v * 10) / 10);
const d = (pts) => `M${pts.map(([x, y]) => `${n(x)} ${n(y)}`).join('L')}`;

// Ветка от точки канала: короткая ломаная в сторону dir (градусы), длина len
function branch(from, dir, len, rnd) {
  const r = (dir * Math.PI) / 180;
  const to = [from[0] + Math.cos(r) * len, from[1] + Math.sin(r) * len];
  return jag([from, to], 0.32, 3, rnd);
}

const GLOW = "stroke='%23A5D5E2'";
function svg(w, h, main, branches, hot) {
  // Каждый контур — один раз в defs, обводки — через use: ветки тоньше и тусклее, под основным каналом
  const parts = [];
  let defs =
    "<defs><radialGradient id='h'><stop offset='0' stop-color='%23FFFFFF'/><stop offset='.35' stop-color='%23DDF6FC' stop-opacity='.8'/><stop offset='1' stop-color='%23A5D5E2' stop-opacity='0'/></radialGradient>";
  defs += `<path id='m' d='${d(main)}'/>`;
  if (branches.length) {
    defs += `<path id='b' d='${branches.map(d).join('')}'/>`;
    parts.push(`<use href='%23b' ${GLOW} stroke-opacity='.22' stroke-width='3.6'/>`);
    parts.push(`<use href='%23b' stroke='%23DDF6FC' stroke-opacity='.75' stroke-width='.8'/>`);
  }
  defs += '</defs>';
  parts.push(`<use href='%23m' ${GLOW} stroke-opacity='.2' stroke-width='7'/>`);
  parts.push(`<use href='%23m' stroke='%23CDF3FE' stroke-opacity='.55' stroke-width='3'/>`);
  parts.push(`<use href='%23m' stroke='%23FFFFFF' stroke-width='1.2'/>`);
  const dots = hot.map(([x, y, r]) => `<circle cx='${n(x)}' cy='${n(y)}' r='${r}' fill='url(%23h)'/>`).join('');
  return `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}'%3E${(
    defs +
    `<g fill='none' stroke-linecap='round' stroke-linejoin='round'>${parts.join('')}</g>${dots}`
  )
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E')}%3C/svg%3E")`;
}

// Разряд на конце кольца (рамка 64 × 56, левый конец; правый — та же форма с .flip):
// от носа гондолы (56, 11) дугой наружу к краю кольца (40, 36), иногда с веткой вниз в воздух.
const END = { w: 64, h: 56, from: [56, 11], to: [40, 36] };
const END_SHAPES = [
  { seed: 11, c: [2, 10], forks: [[0.45, 150, 16]] },
  { seed: 23, c: [10, 26], forks: [[0.6, 120, 13], [0.3, 200, 9]] },
  { seed: 37, c: [-4, 18], forks: [] },
  { seed: 41, c: [6, 4], forks: [[0.5, 165, 18]] },
  { seed: 59, c: [0, 30], forks: [[0.7, 110, 12]] },
  { seed: 67, c: [12, 14], forks: [[0.35, 215, 10], [0.62, 140, 14]] },
];
// Разряд из-под кольца вниз в струю (рамка 68 × 76): от низа кольца ломаной вниз, с ветками в стороны.
const DOWN = { w: 68, h: 76 };
const DOWN_SHAPES = [
  { seed: 101, x0: 26, x1: 40, len: 64, forks: [[0.3, 140, 18], [0.55, 40, 22]] },
  { seed: 113, x0: 40, x1: 24, len: 70, forks: [[0.42, 30, 20], [0.7, 150, 14]] },
  { seed: 127, x0: 33, x1: 36, len: 58, forks: [[0.25, 155, 15], [0.5, 25, 17], [0.75, 120, 10]] },
];

function endShape(s) {
  const rnd = rng(s.seed);
  const base = curve(END.from, s.c, END.to, 4);
  const main = clampPts(jag(base, 0.3, 3, rnd), END.w, END.h);
  const br = s.forks.map(([t, dir, len]) =>
    clampPts(branch(main[Math.round(t * (main.length - 1))], dir, len, rnd), END.w, END.h),
  );
  return svg(END.w, END.h, main, br, [
    [...END.from, 4],
    [...END.to, 5],
  ]);
}

function downShape(s) {
  const rnd = rng(s.seed);
  const a = [s.x0, 3];
  const b = [s.x1, 3 + s.len];
  const c = [(s.x0 + s.x1) / 2 + (rnd() * 2 - 1) * 10, 3 + s.len / 2];
  const main = clampPts(jag(curve(a, c, b, 3), 0.34, 3, rnd), DOWN.w, DOWN.h);
  const br = s.forks.map(([t, dir, len]) =>
    clampPts(branch(main[Math.round(t * (main.length - 1))], dir, len, rnd), DOWN.w, DOWN.h),
  );
  return svg(DOWN.w, DOWN.h, main, br, [[...a, 5]]);
}

const lines = [];
END_SHAPES.forEach((s, i) => lines.push(`.tw .bolt.e${i + 1} { background-image: ${endShape(s)}; }`));
DOWN_SHAPES.forEach((s, i) => lines.push(`.tw .bolt.d${i + 1} { background-image: ${downShape(s)}; }`));
const css = lines.join('\n');

if (process.argv.includes('--write')) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const file = path.join(root, 'design/project/sedmaya.css');
  const src = fs.readFileSync(file, 'utf8');
  const re = /(\/\* bolts:begin[^*]*\*\/\r?\n)[\s\S]*?(\/\* bolts:end \*\/)/;
  if (!re.test(src)) throw new Error('В sedmaya.css нет отметок bolts:begin / bolts:end');
  const nl = src.includes('\r\n') ? '\r\n' : '\n';
  fs.writeFileSync(file, src.replace(re, (_m, a, b) => `${a}${css.replaceAll('\n', nl)}${nl}${b}`));
  console.log(`sedmaya.css: ${lines.length} форм разряда, ${css.length} знаков`);
} else {
  console.log(css);
}
