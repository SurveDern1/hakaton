// Кадр «Падение» (эпилог outro_fall, art.scene = "fall"): живая сцена вместо заглушки.
// Сцена — слои HTML поверх рамки 2:3 (.fx-stage), каждый слой двигается только transform и opacity,
// поэтому на телефоне не перерисовывается целиком. Порядок по времени от появления кадра (scene-fall.css):
// окна гаснут снизу вверх, башня проседает рывками и кренится, обломки падают в туман, рация
// шлёт слабеющие волны → свет радиорубки мигает и гаснет (~6,8 с) → звезда на мачте тухнет →
// Мгла поднимается слоями и накрывает башню, остаются мачта и луна. Заголовок кадра — titleAt в comics.json.
// Одноразовые движения помечены fx-once: касание ускоряет их до конца (viewer.ts), при reduced-motion
// и при листании назад сцена сразу стоит в последнем состоянии.
import './scene-fall.css';

/** Ярусы снизу вверх: левый край, верх, ширина, высота, окна, когда гаснут (с). */
const TIERS = [
  { x: 34, y: 92, w: 32, h: 12, windows: 6, off: 1.3 },
  { x: 36.5, y: 81, w: 27, h: 11, windows: 5, off: 2.6 },
  { x: 39, y: 71, w: 22, h: 10, windows: 4, off: 3.8 },
] as const;

/** Радиорубка — верхний ярус, её окно гаснет последним. */
const CABIN = { x: 43, y: 62, w: 14, h: 9 };

/** Разброс окон в ярусе: гаснут не строем. */
const JITTER = [0, 0.32, 0.11, 0.47, 0.2, 0.58];

function tierSvg(x: number, y: number, w: number, hgt: number): string {
  const s = 0.9; // скос стен внутрь кверху
  return (
    // Тень под карнизом и стена
    `<path d="M${x} ${y + hgt}L${x + s} ${y}L${x + w - s} ${y}L${x + w} ${y + hgt}Z" fill="#1a3437"/>` +
    `<path d="M${x} ${y + hgt}L${x + w} ${y + hgt}L${x + w} ${y + hgt - 1.4}L${x} ${y + hgt - 1.4}Z" fill="#132a2d"/>` +
    // Лунный свет по правому ребру
    `<path d="M${x + w - s - 1.8} ${y}L${x + w - s} ${y}L${x + w} ${y + hgt}L${x + w - 1.6} ${y + hgt}Z" fill="#3a6e79" opacity=".55"/>` +
    // Карниз с бликом
    `<rect x="${x - 1.4}" y="${y - 1.2}" width="${w + 2.8}" height="1.5" fill="#24494f"/>` +
    `<rect x="${x - 1.4}" y="${y - 1.2}" width="${w + 2.8}" height=".35" fill="#5d8e95" opacity=".7"/>`
  );
}

/** Номер сцены в документе: id градиентов не повторяются. */
let serial = 0;

function windowSvg(
  cx: number,
  cy: number,
  w: number,
  hgt: number,
  cls: string,
  t: number,
  halo: string,
): string {
  return (
    `<rect x="${cx - w / 2}" y="${cy - hgt / 2}" width="${w}" height="${hgt}" fill="#0f2225"/>` +
    `<g class="fx-win fx-once ${cls}" style="--t:${t.toFixed(2)}s">` +
    `<ellipse cx="${cx}" cy="${cy}" rx="${w * 1.9}" ry="${hgt * 1.3}" fill="url(#${halo})"/>` +
    `<rect x="${cx - w / 2}" y="${cy - hgt / 2}" width="${w}" height="${hgt}" fill="#f69550"/>` +
    `<rect x="${cx - w / 4}" y="${cy - hgt / 4}" width="${w / 2}" height="${hgt / 2}" fill="#fbe2b0" opacity=".7"/>` +
    '</g>'
  );
}

function towerSvg(): string {
  serial += 1;
  const halo = `fx-halo-${serial}`;
  const red = `fx-red-${serial}`;
  let g =
    `<defs><radialGradient id="${halo}"><stop offset="0" stop-color="#f69550" stop-opacity=".42"/><stop offset="1" stop-color="#f69550" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="${red}"><stop offset="0" stop-color="#e2585c" stop-opacity=".55"/><stop offset="1" stop-color="#c93c41" stop-opacity="0"/></radialGradient></defs>`;
  // Корень — опрокинутый конус с распорками, уходит в туман
  g += '<path d="M36 104L64 104L50 126Z" fill="#1a3437"/>';
  g +=
    '<path d="M40 104L50 120M60 104L50 120M44 104L50 113M56 104L50 113" stroke="#24494f" stroke-width=".5"/>';
  g += '<path d="M60 104L64 104L50 126L52 118Z" fill="#3a6e79" opacity=".4"/>';
  for (const [i, t] of TIERS.entries()) {
    g += tierSvg(t.x, t.y, t.w, t.h);
    const step = t.w / t.windows;
    for (let k = 0; k < t.windows; k++) {
      const cx = t.x + step * (k + 0.5);
      g += windowSvg(cx, t.y + t.h * 0.46, 2.1, 3.4, '', t.off + (JITTER[k] ?? 0) + i * 0.05, halo);
    }
    // Распорки между ярусами
    if (i < TIERS.length - 1) {
      const up = TIERS[i + 1] ?? t;
      g += `<path d="M${t.x + 2} ${t.y - 1}L${up.x + 1} ${up.y + up.h}M${t.x + t.w - 2} ${t.y - 1}L${up.x + up.w - 1} ${up.y + up.h}" stroke="#24494f" stroke-width=".7"/>`;
    }
  }
  // Радиорубка: малое окно гаснет раньше, большое — последним
  g += tierSvg(CABIN.x, CABIN.y, CABIN.w, CABIN.h);
  g += windowSvg(45.4, 66.8, 1.6, 2.6, '', 4.9, halo);
  g += windowSvg(50.6, 66.6, 5.2, 3.8, 'is-radio', 0, halo);
  g += '<path d="M48 66.6h5.2M50.6 64.7v3.8" stroke="#1a3437" stroke-width=".35" class="fx-frame"/>';
  // Мачта-ферма, растяжки, звезда
  g += '<path d="M47.6 61L49.6 45.5M53.6 61L51.6 45.5" stroke="#1a3437" stroke-width=".8"/>';
  g +=
    '<path d="M47.8 59.5L53.3 57L48.2 54.5L52.9 52L48.6 49.5L52.4 47.5" stroke="#1a3437" stroke-width=".45" fill="none"/>';
  g += '<path d="M50.6 46L39.5 71M50.6 46L61.5 71" stroke="#1a3437" stroke-width=".22" opacity=".8"/>';
  g += `<circle class="fx-star-glow fx-once" cx="50.6" cy="43.6" r="6" fill="url(#${red})"/>`;
  g += `<polygon class="fx-star fx-once" points="${star(50.6, 43.6, 2.3)}" fill="#c93c41"/>`;
  return `<svg class="fx-tower-svg" viewBox="0 0 100 150" aria-hidden="true">${g}</svg>`;
}

function star(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.42 : r;
    pts.push(`${(cx + Math.cos(a) * rr).toFixed(2)},${(cy + Math.sin(a) * rr).toFixed(2)}`);
  }
  return pts.join(' ');
}

/**
 * Гребень тумана: полоса 200 × 20 из полуэллипсов, рисунок повторяется через 100 единиц —
 * сдвиг на половину ширины замыкает бесконечный дрейф без шва.
 */
function crest(widths: number[], heights: number[], fade = false): string {
  const bottom = fade ? 40 : 20;
  let d = `M0 ${bottom}L0 13`;
  for (let rep = 0; rep < 2; rep++)
    widths.forEach((w, i) => {
      const hgt = heights[i % heights.length] ?? 6;
      d += `a${w / 2} ${hgt} 0 0 1 ${w} 0`;
    });
  // Дальняя дымка тает книзу внутри самого гребня: без отдельной заливки и шва между ними
  serial += 1;
  const id = `fx-fade-${serial}`;
  const grad = fade
    ? `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset=".1" stop-color="currentColor"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>`
    : '';
  return `<svg class="fx-drift fx-loop${fade ? ' is-fade' : ''}" viewBox="0 0 200 ${bottom}" preserveAspectRatio="none" aria-hidden="true">${grad}<path d="${d}L200 ${bottom}Z"${fade ? ` fill="url(#${id})"` : ''}/></svg>`;
}

/** Слой тумана: --y — верх гребня в процентах рамки, --rise — на сколько поднимется. */
function band(cls: string, widths: number[], heights: number[], fade = false): string {
  const fill = fade ? '' : '<div class="fx-fill"></div>';
  return `<div class="fx-band ${cls}"><div class="fx-rise fx-once">${crest(widths, heights, fade)}${fill}</div></div>`;
}

const STARS: [number, number, number][] = [
  [22, 9, 0.9],
  [34, 17, 0.6],
  [79, 11, 0.8],
  [86, 22, 0.5],
  [15, 26, 0.55],
  [41, 6, 0.7],
  [70, 5, 0.5],
  [28, 31, 0.4],
  [92, 34, 0.45],
];

/** Сцена «Падение» целиком (HTML для .cx-art). */
export function fallScene(): string {
  const stars = STARS.map(
    ([x, y, s], i) =>
      `<i style="left:${x}%;top:${y}%;--s:${s};animation-delay:${(-i * 0.73).toFixed(2)}s" class="fx-loop"></i>`,
  ).join('');
  const waves = [0.5, 1.7, 2.9, 4.1, 5.2]
    .map((t, i) => `<i class="fx-once" style="--t:${t}s;--o:${(0.95 - i * 0.17).toFixed(2)}"></i>`)
    .join('');
  const bits = [
    ['fx-bit-a', 2.3],
    ['fx-bit-b', 4.6],
    ['fx-bit-c', 6.3],
  ]
    .map(([c, t]) => `<i class="fx-bit fx-once ${c}" style="--t:${t}s"></i>`)
    .join('');
  return `<div class="fx fx-fall" aria-hidden="true"><div class="fx-stage">
<div class="fx-sky"></div>
<div class="fx-stars fx-once">${stars}</div>
<div class="fx-moon fx-once"></div>
${band('fx-b0', [17, 24, 13, 21, 25], [5, 7, 4, 6, 8], true)}
${band('fx-b1', [12, 19, 15, 22, 14, 18], [5, 8, 6, 9, 5, 7])}
<div class="fx-tower fx-once">${towerSvg()}<div class="fx-glow fx-once"><i class="fx-loop"></i></div><div class="fx-waves">${waves}</div>${bits}</div>
${band('fx-b2', [22, 14, 26, 17, 21], [8, 5, 9, 6, 7])}
${band('fx-b3', [16, 25, 19, 13, 27], [6, 9, 7, 5, 8])}
${band('fx-b4', [28, 18, 23, 31], [9, 6, 8, 10])}
<div class="fx-shade"></div>
</div></div>`;
}
