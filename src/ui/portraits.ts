// Плакатные знаки событий и подписи персонажей для окна утра. Пока художник не нарисовал портреты,
// каждый `portrait` из data/events.json рисуется простым знаком в духе макета Event.dc.html.
// Ключи `reply.who` совпадают с ключами портретов.

export interface Portrait {
  /** Надпись над именем: откуда говорит персонаж. */
  kicker: string;
  name: string;
  quote?: string;
  /** Цвет плакатной половины. */
  tone: 'red' | 'ether' | 'ochre';
  /** SVG 300×380, цвета — токены sedmaya.css. */
  emblem: string;
  /** Короткая подпись для портрета у реплики. */
  short: string;
}

const MIST = `
  <path d="M20 318 C70 290 110 340 160 312 S250 292 290 318" fill="none" stroke="var(--mist-light)" stroke-width="10" stroke-linecap="round" opacity=".8"/>
  <path d="M0 352 C60 330 120 372 180 348 S260 336 300 352" fill="none" stroke="var(--mist)" stroke-width="12" stroke-linecap="round" opacity=".9"/>`;

const STAR = (cx: number, cy: number, r: number, fill = 'var(--paper)') => {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.42 : r;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="${fill}"/>`;
};

const EMBLEMS = {
  // Плот на гаснущем эфирном баллоне над Мглой — как в макете.
  raft: `
    <circle cx="150" cy="120" r="84" fill="var(--ether-deep)" stroke="var(--paper-ink)" stroke-width="6"/>
    <path d="M150 36 A84 84 0 0 1 150 204 A40 84 0 0 0 150 36 Z" fill="var(--ether)" opacity=".55"/>
    <path d="M66 120 L234 120" stroke="var(--paper-ink)" stroke-width="4"/>
    <path d="M100 196 L84 268 M200 196 L216 268 M150 204 L150 268" stroke="var(--paper-ink)" stroke-width="4"/>
    <path d="M60 268 L240 268 L226 292 L74 292 Z" fill="var(--paper-ink)"/>
    <path d="M84 280 L216 280" stroke="var(--ochre)" stroke-width="3"/>${MIST}`,
  // Трибуна Совета под звездой.
  council: `
    ${STAR(150, 86, 62)}
    <path d="M150 150 L150 196" stroke="var(--paper-ink)" stroke-width="6"/>
    <path d="M70 196 L230 196 L210 300 L90 300 Z" fill="var(--paper-ink)"/>
    <path d="M90 232 L210 232" stroke="var(--ochre)" stroke-width="8"/>
    <path d="M100 258 L200 258" stroke="var(--paper)" stroke-width="3" opacity=".6"/>${MIST}`,
  // Топка ядра и пламя.
  furnace: `
    <rect x="60" y="150" width="180" height="150" fill="var(--paper-ink)"/>
    <path d="M90 300 L90 210 A60 60 0 0 1 210 210 L210 300 Z" fill="var(--ochre)"/>
    <path d="M150 290 C110 270 112 230 136 204 C138 230 152 236 156 226 C164 204 150 180 166 160 C196 196 196 262 150 290 Z" fill="var(--paper)"/>
    <path d="M60 150 L240 150 L224 128 L76 128 Z" fill="var(--paper-ink)"/>
    <path d="M110 128 L110 60 M190 128 L190 80" stroke="var(--paper-ink)" stroke-width="12"/>${MIST}`,
  // Эфирный кристалл с орбитой.
  crystal: `
    <ellipse cx="150" cy="170" rx="128" ry="44" fill="none" stroke="var(--paper-ink)" stroke-width="5" transform="rotate(-18 150 170)"/>
    <path d="M150 40 L206 120 L176 280 L124 280 L94 120 Z" fill="var(--ether)" stroke="var(--paper-ink)" stroke-width="6"/>
    <path d="M150 40 L150 280 M94 120 L206 120" stroke="var(--paper-ink)" stroke-width="3" opacity=".7"/>
    <path d="M150 40 L206 120 L176 280 L150 280 Z" fill="var(--ether-deep)" opacity=".45"/>${MIST}`,
  // Лестница между ярусами, полная людей.
  crowd: `
    <path d="M40 300 L40 260 L90 260 L90 220 L140 220 L140 180 L190 180 L190 140 L240 140 L240 300 Z" fill="var(--paper-ink)"/>
    <circle cx="64" cy="240" r="12" fill="var(--paper)"/><circle cx="114" cy="200" r="12" fill="var(--paper)"/>
    <circle cx="164" cy="160" r="12" fill="var(--ochre)"/><circle cx="214" cy="120" r="12" fill="var(--paper)"/>
    <circle cx="90" cy="244" r="10" fill="var(--mist-light)"/><circle cx="190" cy="124" r="10" fill="var(--mist-light)"/>
    ${STAR(232, 60, 26)}${MIST}`,
  // Радиомачта и волны.
  radio: `
    <path d="M150 60 L110 300 M150 60 L190 300 M122 230 L178 230 M130 170 L170 170 M138 120 L162 120" stroke="var(--paper-ink)" stroke-width="7" fill="none"/>
    <circle cx="150" cy="56" r="14" fill="var(--ochre)"/>
    <path d="M110 30 A56 56 0 0 0 110 82 M190 30 A56 56 0 0 1 190 82" stroke="var(--paper)" stroke-width="6" fill="none" stroke-linecap="round"/>
    <path d="M84 12 A90 90 0 0 0 84 100 M216 12 A90 90 0 0 1 216 100" stroke="var(--paper)" stroke-width="5" fill="none" stroke-linecap="round" opacity=".6"/>${MIST}`,
  // Ветер и солнце Детей Неба.
  wind: `
    <circle cx="150" cy="110" r="56" fill="var(--ochre)" stroke="var(--paper-ink)" stroke-width="6"/>
    <path d="M30 210 C90 180 150 240 210 200 S270 170 280 190" fill="none" stroke="var(--paper)" stroke-width="10" stroke-linecap="round"/>
    <path d="M40 250 C110 226 160 276 230 244" fill="none" stroke="var(--paper-ink)" stroke-width="8" stroke-linecap="round"/>
    <path d="M150 30 L150 14 M150 206 L150 190 M70 110 L54 110 M246 110 L230 110" stroke="var(--paper-ink)" stroke-width="6"/>${MIST}`,
  // Ключ основателя в раме.
  key: `
    <rect x="70" y="40" width="160" height="230" fill="none" stroke="var(--paper-ink)" stroke-width="8"/>
    <circle cx="150" cy="110" r="34" fill="none" stroke="var(--ochre)" stroke-width="12"/>
    <path d="M150 144 L150 236 M150 200 L178 200 M150 222 L170 222" stroke="var(--ochre)" stroke-width="12"/>${MIST}`,
  // Эфирная ракета под звездой: собака Звёздочка из питомника Института.
  rocket: `
    ${STAR(222, 64, 24)}
    <path d="M150 40 C182 80 190 150 180 236 L120 236 C110 150 118 80 150 40 Z" fill="var(--paper)" stroke="var(--paper-ink)" stroke-width="6"/>
    <circle cx="150" cy="128" r="20" fill="var(--ether)" stroke="var(--paper-ink)" stroke-width="5"/>
    <path d="M120 196 L88 250 L122 236 Z M180 196 L212 250 L178 236 Z" fill="var(--paper-ink)"/>
    <path d="M130 236 L150 292 L170 236 Z" fill="var(--ochre)"/>${MIST}`,
} as const;

export const PORTRAITS: Record<string, Portrait> = {
  council: {
    kicker: 'Зал Совета',
    name: 'Совет колонии',
    short: 'Совет',
    tone: 'red',
    emblem: EMBLEMS.council,
  },
  iya: {
    kicker: 'С плота',
    name: 'Ия, 10 лет',
    short: 'Ия',
    quote: '«Они не злые. Они просто не помнят, где их дом».',
    tone: 'red',
    emblem: EMBLEMS.raft,
  },
  marta: {
    kicker: 'Кочегары',
    name: 'Марта',
    short: 'Марта',
    quote: 'Старший кочегар Корня',
    tone: 'red',
    emblem: EMBLEMS.furnace,
  },
  ilyin: {
    kicker: 'Институт эфира',
    name: 'Профессор Ильин',
    short: 'Ильин',
    tone: 'ether',
    emblem: EMBLEMS.crystal,
  },
  crowd: {
    kicker: 'Лестница ярусов',
    name: 'Колония',
    short: 'Колония',
    tone: 'red',
    emblem: EMBLEMS.crowd,
  },
  lev: {
    kicker: 'Радиорубка',
    name: 'Радист Лев',
    short: 'Лев',
    tone: 'ether',
    emblem: EMBLEMS.radio,
  },
  wind: {
    kicker: 'Дети Неба',
    name: 'Брат Ветер',
    short: 'Ветер',
    tone: 'ochre',
    emblem: EMBLEMS.wind,
  },
  zvezdochka: {
    kicker: 'Питомник Института',
    name: 'Звёздочка',
    short: 'Звёздочка',
    tone: 'ochre',
    emblem: EMBLEMS.rocket,
  },
  vershov: {
    kicker: 'Основатель',
    name: 'Аркадий Вересов',
    short: 'Вересов',
    tone: 'ether',
    emblem: EMBLEMS.key,
  },
};

const FALLBACK: Portrait = {
  kicker: 'Седьмая',
  name: 'Утро над Мглой',
  short: '',
  tone: 'red',
  emblem: EMBLEMS.council,
};

export function portraitOf(key: string | undefined): Portrait {
  return (key && PORTRAITS[key]) || FALLBACK;
}

/** Значки фракций для подсказок, 16×16, цвет — currentColor. Туманники — глаз из макета. */
export const FACTION_ICONS: Record<string, string> = {
  stokers: '<path d="M12 21c-4 0-6-3-6-6 0-4 4-6 4-11 3 2 4 5 4 7 1-1 2-2 2-4 2 2 2 5 2 8 0 3-2 6-6 6z"/>',
  institute:
    '<path d="M9 3h6M10 3v6l-5 10a1.5 1.5 0 0 0 1.4 2h11.2a1.5 1.5 0 0 0 1.4-2L14 9V3"/><path d="M7 15h10"/>',
  mistborn: '<path d="M2 12c4-6 16-6 20 0-4 6-16 6-20 0z"/><circle cx="12" cy="12" r="3"/>',
  sky: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
};

export function svgIcon(body: string, size = 16): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
