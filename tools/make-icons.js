// Иконки игры: рисует SVG и растрирует их в PNG и ICO.
// Запуск: npm run icons (нужен установленный Chrome или Edge; путь можно задать в CHROME).
// Результат лежит в public/ и хранится в git, так что сборке и CI Chrome не нужен.
//   favicon.svg          — основная иконка: звезда над башней и Мглой (для вкладки от 32 px)
//   favicon-small.svg    — только звезда, для 16 px (из неё favicon.ico 16 + 32)
//   apple-touch-icon.png — 180, icon-192.png, icon-512.png — полный рисунок с полями под маску
// Цвета — токены design/project/sedmaya.css.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const OUT = path.join(__dirname, '..', 'public');
const C = {
  ink: '#1A3437',
  ink2: '#1F3F44',
  ink3: '#24494F',
  line: '#3A6E79',
  paper: '#FBF0D6',
  paper2: '#EFDDB8',
  red: '#C93C41',
  redDeep: '#8F2A2F',
  ochre: '#F69550',
  ochreDeep: '#C46F35',
  ether: '#9FD6DF',
  mistLight: '#C9D6D2',
  mist: '#8FAAAD',
  starHi: '#FE6C6B',
  starLo: '#B4232E',
};

const r2 = (n) => Math.round(n * 100) / 100;

// Вершины пятиконечной звезды: чётные — лучи, нечётные — впадины.
function starPoints(cx, cy, R) {
  const r = R * 0.382;
  const pts = [];
  for (let k = 0; k < 10; k++) {
    const a = ((-90 + k * 36) * Math.PI) / 180;
    const rad = k % 2 ? r : R;
    pts.push([r2(cx + rad * Math.cos(a)), r2(cy + rad * Math.sin(a))]);
  }
  return pts;
}

const poly = (pts) => pts.map((p) => p.join(',')).join(' ');

// Гранёная звезда, как .tw .star.big: светлая и тёмная грани чередуются по 36°.
function facetStar(cx, cy, R, hi, lo) {
  const pts = starPoints(cx, cy, R);
  let s = '';
  for (let k = 0; k < 10; k++) {
    const a = pts[k];
    const b = pts[(k + 1) % 10];
    s += `<polygon points="${cx},${cy} ${a.join(',')} ${b.join(',')}" fill="${k % 2 ? lo : hi}"/>`;
  }
  return s;
}

// Основная иконка в квадрате 64. pad — поле под маску (доля стороны), round — скруглённые углы фона.
function fullIcon({ pad = 0, round = true } = {}) {
  const k = 1 - pad * 2;
  const o = 32 - 32 * k;
  const bg = round
    ? `<rect width="64" height="64" rx="13" fill="url(#bg)"/>`
    : `<rect width="64" height="64" fill="url(#bg)"/>`;
  const sx = 32;
  const sy = 22.5;
  const body = [
    // Свечение звезды
    `<circle cx="${sx}" cy="${sy}" r="22" fill="url(#halo)"/>`,
    // Лучи плаката за звездой
    ...[-60, -30, 0, 30, 60].map(
      (d) =>
        `<polygon points="${sx},${sy} ${r2(sx - 3)},-20 ${r2(sx + 3)},-20" fill="${C.paper}" opacity=".07" transform="rotate(${d} ${sx} ${sy})"/>`,
    ),
    // Башня: шпиль, два яруса с окнами, двигатели с эфиром
    `<rect x="30.6" y="35" width="2.8" height="4" fill="${C.paper2}"/>`,
    `<polygon points="24,39 40,39 38.5,45 25.5,45" fill="${C.paper}"/>`,
    `<rect x="26" y="45" width="12" height="1.4" fill="${C.redDeep}"/>`,
    `<polygon points="21,46.4 43,46.4 41,53 23,53" fill="${C.paper2}"/>`,
    `<rect x="27" y="40.6" width="2.2" height="2.6" fill="${C.ink2}"/>`,
    `<rect x="34.8" y="40.6" width="2.2" height="2.6" fill="${C.ink2}"/>`,
    `<rect x="25" y="48.3" width="2.4" height="2.8" fill="${C.ochre}"/>`,
    `<rect x="30.8" y="48.3" width="2.4" height="2.8" fill="${C.ochre}"/>`,
    `<rect x="36.6" y="48.3" width="2.4" height="2.8" fill="${C.ochre}"/>`,
    `<polygon points="25,53 29,53 28,55.5 26,55.5" fill="${C.line}"/>`,
    `<polygon points="35,53 39,53 38,55.5 36,55.5" fill="${C.line}"/>`,
    `<ellipse cx="27" cy="57.5" rx="2" ry="2.6" fill="${C.ether}" opacity=".85"/>`,
    `<ellipse cx="37" cy="57.5" rx="2" ry="2.6" fill="${C.ether}" opacity=".85"/>`,
    // Звезда: обод и гранёная середина
    facetStar(sx, sy, 19, C.paper, C.ochreDeep),
    facetStar(sx, sy, 15.6, C.starHi, C.starLo),
  ].join('');
  const mist = [
    `<path d="M-2 60 Q4 55.5 10 58.5 Q16 54.5 23 58.5 Q32 56 40 59 Q47 54.8 54 58.4 Q60 55.6 66 58.5 V66 H-2Z" fill="${C.mist}" opacity=".75"/>`,
    `<path d="M-2 62.5 Q6 58.8 14 61.4 Q22 58.6 30 61.6 Q40 58.8 48 61.6 Q57 59 66 61.6 V66 H-2Z" fill="${C.mistLight}"/>`,
  ].join('');
  return svgDoc(
    64,
    `${bg}<g clip-path="url(#clip)"><g transform="translate(${r2(o)} ${r2(o)}) scale(${r2(k)})">${body}</g>${mist}</g>`,
    round ? 13 : 0,
  );
}

// Упрощённая иконка для 16 px: одна звезда на тёмном фоне.
function smallIcon() {
  const body = facetStar(8, 8.75, 7.4, '#F75C5E', C.red);
  return svgDoc(16, `<rect width="16" height="16" rx="3" fill="${C.ink}"/>${body}`, 3, true);
}

function svgDoc(size, inner, rx, plain = false) {
  const defs = plain
    ? ''
    : `<defs>
<radialGradient id="bg" cx=".5" cy=".3" r=".8"><stop offset="0" stop-color="${C.ink3}"/><stop offset="1" stop-color="${C.ink}"/></radialGradient>
<radialGradient id="halo"><stop offset="0" stop-color="#FE6364" stop-opacity=".55"/><stop offset="1" stop-color="#FE6364" stop-opacity="0"/></radialGradient>
<clipPath id="clip"><rect width="${size}" height="${size}" rx="${rx}"/></clipPath>
</defs>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${defs}${inner}</svg>\n`;
}

function findChrome() {
  const list = [
    process.env.CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  const found = list.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error('Не найден Chrome: задайте путь в переменной CHROME');
  return found;
}

// Растрирует SVG в PNG нужного размера через headless Chrome.
function rasterize(chrome, svg, size, file) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sedmaya-icon-'));
  const html = path.join(tmp, 'icon.html');
  const data = Buffer.from(svg).toString('base64');
  fs.writeFileSync(
    html,
    `<!doctype html><style>html,body{margin:0;background:transparent}img{display:block;width:${size}px;height:${size}px}</style><img src="data:image/svg+xml;base64,${data}">`,
  );
  execFileSync(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--default-background-color=00000000',
      `--user-data-dir=${path.join(tmp, 'profile')}`,
      `--window-size=${size},${size}`,
      `--screenshot=${file}`,
      `file:///${html.replace(/\\/g, '/')}`,
    ],
    { stdio: 'ignore' },
  );
  fs.rmSync(tmp, { recursive: true, force: true });
  return fs.readFileSync(file);
}

// ICO с PNG внутри (поддерживают все современные браузеры).
function makeIco(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(({ size, buf }, i) => {
    const e = 6 + i * 16;
    head.writeUInt8(size >= 256 ? 0 : size, e);
    head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(buf.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += buf.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.buf)]);
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const out = (f) => path.join(OUT, f);
  const full = fullIcon();
  const small = smallIcon();
  const touch = fullIcon({ pad: 0.1, round: false });
  fs.writeFileSync(out('favicon.svg'), full);
  fs.writeFileSync(out('favicon-small.svg'), small);

  const chrome = findChrome();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sedmaya-ico-'));
  const ico = [16, 32].map((size) => ({ size, buf: rasterize(chrome, small, size, path.join(tmp, `${size}.png`)) }));
  fs.writeFileSync(out('favicon.ico'), makeIco(ico));
  fs.rmSync(tmp, { recursive: true, force: true });
  rasterize(chrome, touch, 180, out('apple-touch-icon.png'));
  rasterize(chrome, touch, 192, out('icon-192.png'));
  rasterize(chrome, touch, 512, out('icon-512.png'));
  console.log('Иконки обновлены в public/');
}

main();
