// Картинки для карточки реплики — предметы-знаки персонажей в манере комикса пролога
// (public/comics/intro): плоский советский плакат, лучи, тень одной плашкой справа, туман клубами снизу.
// Людей не рисуем — только предмет, по которому персонажа узнают. Зерно бумаги накладывает CSS
// (.ev-reply-face::after), анимацию — классы .ra-* в event-window.css.
// Холст 240×300, кадр обрезается под карточку (xMidYMid slice): предмет держим в середине, x 60…180.
// Ключи совпадают с portrait / reply.who из data/events.json.

const C = {
  ink: '#1A3437',
  ink2: '#1F3F44',
  ink3: '#24494F',
  deep: '#13282B',
  paper: '#FBF0D6',
  paper2: '#EFDDB8',
  red: '#C93C41',
  redHi: '#DD5156',
  redDeep: '#8F2A2F',
  ochre: '#F69550',
  ochreDeep: '#C46F35',
  ether: '#9FD6DF',
  etherDeep: '#255D6B',
  mist: '#8FAAAD',
  mistLight: '#C9D6D2',
} as const;

/** Лучи из точки: n клиньев по кругу, как солнце на пятой странице пролога. */
function rays(cx: number, cy: number, n: number, fill: string, opacity: number, width = 0.5): string {
  const R = 420;
  let d = '';
  for (let i = 0; i < n; i++) {
    const a0 = (i * 2 * Math.PI) / n;
    const a1 = a0 + (Math.PI / n) * width * 2;
    const p = (a: number) => `${(cx + R * Math.cos(a)).toFixed(1)} ${(cy + R * Math.sin(a)).toFixed(1)}`;
    d += `M${cx} ${cy}L${p(a0)}L${p(a1)}Z`;
  }
  return `<g class="ra-rays" style="transform-origin:${cx}px ${cy}px"><path d="${d}" fill="${fill}" opacity="${opacity}"/></g>`;
}

/** Гряда облаков снизу: клубы-круги в два слоя, как облака под башней на седьмой странице. */
function puffs(y: number, back: string, front: string, opacity = 1): string {
  const row = (yy: number, xs: number[], r: number[], fill: string) =>
    xs.map((x, i) => `<circle cx="${x}" cy="${yy}" r="${r[i]}"/>`).join('') +
    `<rect x="-20" y="${yy}" width="280" height="${320 - yy}" fill="${fill}"/>`;
  return `<g class="ra-mist" opacity="${opacity}">
    <g fill="${back}">${row(y, [-6, 44, 96, 150, 200, 248], [30, 38, 32, 40, 34, 30], back)}</g>
    <g fill="${front}">${row(y + 22, [16, 70, 122, 176, 230], [32, 28, 36, 30, 34], front)}</g>
  </g>`;
}

const STAR = (cx: number, cy: number, r: number, fill: string) => {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.42 : r;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="${fill}"/>`;
};

const ART: Record<string, string> = {
  // Ия — плот под гаснущим эфирным баллоном над Мглой.
  iya: `
    <rect width="240" height="300" fill="${C.red}"/>
    ${rays(120, 104, 18, C.redHi, 0.6)}
    <g class="ra-figure">
      <path d="M78 150 L92 222 M162 150 L148 222 M120 166 V222" stroke="${C.ink}" stroke-width="3.5"/>
      <circle cx="120" cy="100" r="64" fill="${C.etherDeep}"/>
      <path d="M120 36 A64 64 0 0 0 120 164 A34 64 0 0 1 120 36 Z" fill="${C.ether}"/>
      <path d="M120 36 A34 64 0 0 0 120 164" fill="none" stroke="${C.ink}" stroke-width="3"/>
      <path d="M56 100 H184" stroke="${C.ochre}" stroke-width="7"/>
      <path d="M86 46 C76 60 74 76 76 88 M154 46 C164 60 166 76 164 88" stroke="${C.paper}" stroke-width="4" fill="none" opacity=".5" stroke-linecap="round"/>
      <path d="M140 150 C150 158 152 168 146 174 C142 166 138 160 140 150 Z" fill="${C.ether}" opacity=".55"/>
      <path d="M64 222 H176 L166 240 H74 Z" fill="${C.ink}"/>
      <path d="M72 230 H168" stroke="${C.ochreDeep}" stroke-width="3"/>
      <path d="M86 222 V240 M106 222 V240 M126 222 V240 M146 222 V240" stroke="${C.ink3}" stroke-width="2.5"/>
      <rect x="138" y="206" width="12" height="16" fill="${C.ink}"/><rect x="141" y="210" width="6" height="8" fill="${C.ochre}"/>
    </g>
    ${puffs(274, C.mist, C.mistLight, 0.95)}`,

  // Марта — топка Корня: раскалённая дверца, пламя, лопата у стены, искры.
  marta: `
    <rect width="240" height="300" fill="${C.redDeep}"/>
    ${rays(120, 196, 16, C.red, 0.75, 0.55)}
    <circle cx="120" cy="196" r="96" fill="${C.ochreDeep}" opacity=".45"/>
    <g class="ra-figure">
      <path d="M44 300 V120 H196 V300 Z" fill="${C.ink3}"/>
      <path d="M120 120 H196 V300 H120 Z" fill="${C.ink}"/>
      <path d="M36 120 H204 L194 100 H46 Z" fill="${C.ink}"/>
      <path d="M78 100 V40 H98 V100 Z M142 100 V58 H162 V100 Z" fill="${C.ink2}"/>
      <path d="M88 40 V100 M152 58 V100" stroke="${C.ink}" stroke-width="10" opacity=".5"/>
      <path d="M68 270 V200 A52 52 0 0 1 172 200 V270 Z" fill="${C.deep}"/>
      <path d="M78 270 V204 A42 42 0 0 1 162 204 V270 Z" fill="${C.ochre}"/>
      <path d="M120 266 C88 252 90 222 108 202 C110 222 122 226 124 216 C130 196 118 178 132 160 C160 190 158 246 120 266 Z" fill="${C.paper}"/>
      <path d="M120 266 C104 256 106 238 114 228 C118 240 128 238 128 230 C138 244 136 258 120 266 Z" fill="${C.ochre}"/>
      <path d="M60 270 H180" stroke="${C.ink}" stroke-width="8"/>
      <path d="M66 140 H174" stroke="${C.ochreDeep}" stroke-width="3" opacity=".6"/>
      <circle cx="58" cy="132" r="4" fill="${C.ochreDeep}"/><circle cx="182" cy="132" r="4" fill="${C.ochreDeep}"/>
      <path d="M204 300 L222 128" stroke="${C.ochreDeep}" stroke-width="7" stroke-linecap="round"/>
      <path d="M214 140 L234 132 L240 108 L222 94 L204 112 Z" fill="${C.ink}"/>
      <path d="M214 140 L222 94 L240 108 L234 132 Z" fill="${C.ink2}"/>
    </g>
    <g class="ra-sparks" fill="${C.ochre}">
      <circle cx="40" cy="232" r="3"/><circle cx="200" cy="168" r="2.5"/><circle cx="70" cy="84" r="2"/>
      <circle cx="176" cy="84" r="3"/><circle cx="30" cy="180" r="2"/><circle cx="120" cy="140" r="2.5"/>
    </g>`,

  // Профессор Ильин — эфирный кристалл с орбитой, светится в лаборатории.
  ilyin: `
    <rect width="240" height="300" fill="${C.etherDeep}"/>
    ${rays(120, 150, 16, C.ether, 0.18)}
    <circle cx="120" cy="150" r="78" fill="${C.ether}" opacity=".16"/>
    <g class="ra-figure">
      <ellipse cx="120" cy="160" rx="104" ry="32" fill="none" stroke="${C.paper2}" stroke-width="4" transform="rotate(-16 120 160)" opacity=".85"/>
      <path d="M120 54 L168 116 L144 244 H96 L72 116 Z" fill="${C.ether}"/>
      <path d="M120 54 L168 116 L144 244 H120 Z" fill="${C.etherDeep}" opacity=".55"/>
      <path d="M72 116 H168 M120 54 V244 M96 244 L120 116 L144 244" stroke="${C.ink}" stroke-width="2.5" opacity=".55" fill="none"/>
      <path d="M86 112 L112 72" stroke="${C.paper}" stroke-width="5" stroke-linecap="round" opacity=".8"/>
      <path d="M20 160 C60 192 180 192 220 160" fill="none" stroke="${C.paper2}" stroke-width="4" transform="rotate(-16 120 160)"/>
      <circle cx="210" cy="126" r="7" fill="${C.ochre}"/>
      <path d="M64 252 H176 L164 270 H76 Z" fill="${C.ink}"/>
      <path d="M76 260 H164" stroke="${C.ochre}" stroke-width="3"/>
    </g>
    <g class="ra-sparks" fill="${C.paper}">
      ${STAR(52, 70, 7, C.paper)}${STAR(190, 214, 6, C.ether)}${STAR(184, 52, 5, C.paper)}
    </g>`,

  // Радист Лев — радиомачта и волны эфира, как антенна на пятой странице пролога.
  lev: `
    <rect width="240" height="300" fill="${C.etherDeep}"/>
    ${rays(120, 92, 16, C.ether, 0.1)}
    <g class="ra-waves" fill="none" stroke="${C.ochre}" stroke-linecap="round" style="transform-origin:120px 92px">
      <path d="M86 58 A48 48 0 0 0 86 126 M154 58 A48 48 0 0 1 154 126" stroke-width="8"/>
      <path d="M62 34 A82 82 0 0 0 62 150 M178 34 A82 82 0 0 1 178 150" stroke-width="7" opacity=".7"/>
      <path d="M38 10 A116 116 0 0 0 38 174 M202 10 A116 116 0 0 1 202 174" stroke-width="6" opacity=".4"/>
    </g>
    <g class="ra-figure">
      <path d="M120 92 L80 280 M120 92 L160 280" stroke="${C.paper2}" stroke-width="8" fill="none"/>
      <path d="M100 186 H140 M93 220 H147 M86 254 H154 M108 146 H132" stroke="${C.paper2}" stroke-width="6"/>
      <path d="M120 92 L160 280" stroke="${C.mist}" stroke-width="8" opacity=".55"/>
      <circle cx="120" cy="88" r="14" fill="${C.paper}"/>
      <path d="M120 74 A14 14 0 0 1 120 102 Z" fill="${C.mistLight}"/>
      <path d="M60 280 H180" stroke="${C.ink}" stroke-width="8"/>
    </g>
    ${puffs(282, C.ink3, C.ink2, 1)}`,

  // Брат Ветер, Дети Неба — красный воздушный змей на ветру против солнца, внизу облака.
  wind: `
    <rect width="240" height="300" fill="${C.ochre}"/>
    ${rays(120, 120, 20, C.ochreDeep, 0.35)}
    <circle cx="120" cy="120" r="70" fill="${C.paper2}"/>
    <g class="ra-streaks" stroke="${C.paper}" stroke-linecap="round" fill="none" opacity=".9">
      <path d="M6 60 C40 52 60 70 96 58" stroke-width="5"/><path d="M150 30 C180 22 200 38 236 28" stroke-width="4"/>
      <path d="M170 210 C196 202 214 218 240 210" stroke-width="5"/><path d="M0 196 C30 190 46 204 74 196" stroke-width="4"/>
    </g>
    <g class="ra-figure">
      <path d="M150 196 C130 220 160 236 132 258 C114 272 120 286 96 300" stroke="${C.ink}" stroke-width="3" fill="none"/>
      <path d="M140 230 L128 222 L132 236 Z M126 262 L112 258 L120 270 Z" fill="${C.red}"/>
      <path d="M152 46 L198 112 L152 196 L106 112 Z" fill="${C.red}"/>
      <path d="M152 46 L198 112 L152 196 Z" fill="${C.redDeep}"/>
      <path d="M152 46 V196 M106 112 H198" stroke="${C.ink}" stroke-width="3"/>
      ${STAR(130, 92, 11, C.paper)}
    </g>
    ${puffs(264, C.paper2, C.paper, 1)}`,

  // Аркадий Вересов, основатель — старый ключ на цепи в холодном свете эфира, вокруг туман.
  vershov: `
    <rect width="240" height="300" fill="${C.deep}"/>
    ${rays(120, 300, 14, C.etherDeep, 0.6, 0.45)}
    <circle cx="120" cy="150" r="84" fill="${C.ether}" opacity=".1"/>
    <g class="ra-back" fill="none" stroke="${C.mistLight}" stroke-linecap="round" opacity=".28">
      <path d="M0 74 C40 54 70 84 110 66 S180 44 240 70" stroke-width="10"/>
      <path d="M0 116 C30 102 50 122 70 110" stroke-width="7"/><path d="M176 108 C200 98 220 114 240 104" stroke-width="7"/>
    </g>
    <g class="ra-figure">
      <path d="M120 0 V46" stroke="${C.mist}" stroke-width="4" stroke-dasharray="7 5"/>
      <circle cx="120" cy="80" r="34" fill="none" stroke="${C.ochre}" stroke-width="14"/>
      <path d="M120 46 A34 34 0 0 1 120 114" fill="none" stroke="${C.ochreDeep}" stroke-width="14"/>
      <circle cx="120" cy="80" r="12" fill="${C.ochre}"/><circle cx="120" cy="80" r="5" fill="${C.deep}"/>
      <rect x="112" y="112" width="16" height="132" fill="${C.ochre}"/>
      <rect x="120" y="112" width="8" height="132" fill="${C.ochreDeep}"/>
      <path d="M128 196 H156 V210 H144 V222 H156 V236 H128 Z" fill="${C.ochre}"/>
      <path d="M128 210 H144 M128 222 H144" stroke="${C.ochreDeep}" stroke-width="4"/>
      <path d="M104 126 H136" stroke="${C.ochreDeep}" stroke-width="5"/>
      <path d="M96 68 C100 58 108 52 116 50" stroke="${C.paper}" stroke-width="4" fill="none" opacity=".7" stroke-linecap="round"/>
    </g>
    ${puffs(258, C.mist, C.mistLight, 0.5)}`,

  // Совет колонии — трибуна с микрофоном под звездой.
  council: `
    <rect width="240" height="300" fill="${C.red}"/>
    ${rays(120, 70, 18, C.redHi, 0.6)}
    ${STAR(120, 64, 40, C.ochre)}
    <g class="ra-figure">
      <path d="M120 186 V150" stroke="${C.ink}" stroke-width="5"/>
      <path d="M120 150 C120 136 138 132 144 124" stroke="${C.ink}" stroke-width="4" fill="none"/>
      <rect x="138" y="106" width="18" height="26" rx="9" fill="${C.ink2}" transform="rotate(30 147 119)"/>
      <path d="M44 186 H196 L180 300 H60 Z" fill="${C.ink2}"/>
      <path d="M120 186 H196 L180 300 H120 Z" fill="${C.ink}"/>
      <path d="M36 176 H204 V190 H36 Z" fill="${C.ink}"/>
      <path d="M52 214 H188" stroke="${C.ochre}" stroke-width="10"/>
      ${STAR(120, 256, 18, C.red)}
    </g>`,

  // Колония — лестница ярусов с горящими окнами и флагом, против красного солнца.
  crowd: `
    <rect width="240" height="300" fill="${C.red}"/>
    ${rays(120, 110, 18, C.ochre, 0.4)}
    <circle cx="120" cy="110" r="44" fill="${C.ochre}" opacity=".6"/>
    <g class="ra-figure">
      <path d="M20 300 V250 H70 V210 H120 V170 H170 V130 H220 V300 Z" fill="${C.ink2}"/>
      <path d="M220 130 V300 H190 V130 Z" fill="${C.ink}"/>
      <path d="M20 250 H70 M70 210 H120 M120 170 H170 M170 130 H220" stroke="${C.ochre}" stroke-width="4"/>
      <g fill="${C.ochre}">
        <rect x="34" y="262" width="10" height="16"/><rect x="50" y="262" width="10" height="16"/>
        <rect x="84" y="222" width="10" height="16"/><rect x="100" y="222" width="10" height="16"/>
        <rect x="134" y="182" width="10" height="16"/><rect x="150" y="182" width="10" height="16"/>
        <rect x="178" y="142" width="10" height="16"/>
      </g>
      <path d="M200 130 V56" stroke="${C.ink}" stroke-width="4"/>
      <path d="M200 58 L156 64 L166 76 L158 90 L200 84 Z" fill="${C.redHi}"/>
      ${STAR(180, 74, 6, C.ochre)}
    </g>`,

  // Звёздочка из питомника Института — эфирная ракета под звездой, отпечаток лапы на борту.
  zvezdochka: `
    <rect width="240" height="300" fill="${C.etherDeep}"/>
    ${rays(120, 130, 20, C.ether, 0.12)}
    ${STAR(196, 50, 18, C.red)}${STAR(40, 76, 8, C.paper)}${STAR(206, 170, 5, C.paper)}
    <g class="ra-figure">
      <path d="M100 222 L120 290 L140 222 Z" fill="${C.ochre}"/>
      <path d="M110 222 L120 262 L130 222 Z" fill="${C.paper}"/>
      <path d="M120 30 C156 70 164 140 154 226 H86 C76 140 84 70 120 30 Z" fill="${C.paper}"/>
      <path d="M120 30 C156 70 164 140 154 226 H120 Z" fill="${C.paper2}"/>
      <path d="M120 30 C134 46 144 62 150 80 H90 C96 62 106 46 120 30 Z" fill="${C.red}"/>
      <circle cx="120" cy="122" r="20" fill="${C.ether}" stroke="${C.ink}" stroke-width="5"/>
      <path d="M110 114 L118 106" stroke="${C.paper}" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M86 174 L52 236 L88 222 Z M154 174 L188 236 L152 222 Z" fill="${C.red}"/>
      <path d="M154 174 L188 236 L152 222 Z" fill="${C.redDeep}"/>
      <g fill="${C.ink3}">
        <ellipse cx="120" cy="190" rx="9" ry="7"/><circle cx="108" cy="177" r="4"/><circle cx="116" cy="171" r="4"/>
        <circle cx="125" cy="171" r="4"/><circle cx="133" cy="177" r="4"/>
      </g>
    </g>
    ${puffs(276, C.ink3, C.ink2, 1)}`,
};

/** SVG предмета для карточки реплики; неизвестный ключ — трибуна Совета. */
export function replyArt(key: string | undefined): string {
  const body = (key && ART[key]) || ART.council;
  return `<svg class="ra" viewBox="0 0 240 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${body}</svg>`;
}

export const REPLY_ART_KEYS = Object.keys(ART);
