// Сборка файлов звуков public/sounds/*.mp3 из паков Kenney (CC0): npm run sounds.
// Нужны ffmpeg (переменная FFMPEG или в PATH) и распакованные паки в папке KENNEY:
//   KENNEY/x-rpg-audio, KENNEY/x-impact-sounds (zip с kenney.nl/assets/rpg-audio, …/impact-sounds).
// Каждый фрагмент: ffmpeg декодирует источник (с подстройкой высоты и фильтрами из SOUNDS) в моно 44,1 кГц,
// дальше здесь — обрезка тишины (−50 дБFS), выравнивание громкости фрагментов одного файла по LUFS
// (metrics.ts, та же мера, что в check:sound), подъём и спад по 5 мс, склейка через паузы, пик −3 дБFS,
// mp3 112 кбит/с. Отметки фрагментов печатаются в конце — их вписывают в `offsets` манифеста
// src/audio/samples.ts. Готовые mp3 лежат в git: сборке и CI ни ffmpeg, ни паки не нужны.
// Источник и лицензия каждого файла — public/sounds/CREDITS.md.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lufs } from '../src/audio/metrics.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'public', 'sounds');
const SR = 44100;
/** Порог тишины при обрезке, дБFS. */
const SILENCE_DB = -50;
/** Подъём и спад на краях фрагмента, с. */
const FADE = 0.005;
/** Пауза между фрагментами в файле, с: отметки не задевают соседа даже со сдвигом декодера mp3. */
const GAP = 0.25;
/** Запас отметки фрагмента до и после звука, с (внутри паузы). */
const PAD = 0.02;
/** Пик файла, дБFS. */
const PEAK_DB = -3;
const BITRATE = '112k';

/**
 * Файлы и их фрагменты. `src` — путь внутри KENNEY; `rate` — множитель частоты дискретизации
 * (меньше 1 — ниже и дольше, как замедленная плёнка); `af` — фильтры ffmpeg после него;
 * `boost` — поправка громкости фрагмента после выравнивания, дБ (короткий кусок под реверберацией
 * игры звучит тише, чем по LUFS без неё);
 * `mix` — слои, которые складываются (у каждого свои rate, af и громкость `gain`).
 */
const SOUNDS = {
  // Стон металла: дверная петля, замедленная до низкого протяжного скрипа, поверх — гулкий металлический
  // котелок ещё ниже, с отражениями как в пустой конструкции
  'creak-metal': [
    {
      mix: [
        { src: 'x-rpg-audio/Audio/doorOpen_2.ogg', rate: 0.6, af: 'highpass=f=90,lowpass=f=5000', gain: 1 },
        { src: 'x-rpg-audio/Audio/metalPot1.ogg', rate: 0.5, af: 'lowpass=f=2500', gain: 0.45 },
      ],
      af: 'aecho=0.8:0.5:37|61:0.3|0.2',
    },
  ],
  // Скрипы дерева: пять разных, один чуть ниже — для разнообразия повторов
  'creak-wood': [
    { src: 'x-rpg-audio/Audio/creak1.ogg' },
    { src: 'x-rpg-audio/Audio/creak2.ogg' },
    { src: 'x-rpg-audio/Audio/creak3.ogg' },
    { src: 'x-rpg-audio/Audio/doorOpen_1.ogg', rate: 0.9 },
    { src: 'x-rpg-audio/Audio/creak2.ogg', rate: 0.82 },
  ],
  // Отрыв листка: перелистывание страницы, чуть быстрее и без гула стола
  'paper-tear': [
    { src: 'x-rpg-audio/Audio/bookFlip1.ogg', rate: 1.15, af: 'highpass=f=250' },
    { src: 'x-rpg-audio/Audio/bookFlip2.ogg', rate: 1.1, af: 'highpass=f=250' },
    { src: 'x-rpg-audio/Audio/bookFlip3.ogg', rate: 0.85, af: 'highpass=f=250', boost: 2 },
  ],
  // Рычаг двигателя: металлический щелчок, опущенный тоном — тяжелее, а под ним защёлка
  lever: [
    {
      mix: [
        { src: 'x-rpg-audio/Audio/metalClick.ogg', rate: 0.85, gain: 1 },
        { src: 'x-rpg-audio/Audio/metalLatch.ogg', rate: 0.75, gain: 0.5, delay: 0.05 },
      ],
    },
  ],
};

const db = (v) => 20 * Math.log10(Math.max(v, 1e-12));

/** Декодировать слой в моно Float32Array 44,1 кГц. */
function decode(ffmpeg, kenney, layer) {
  const file = path.join(kenney, layer.src);
  if (!fs.existsSync(file)) throw new Error(`нет файла ${file}`);
  const filters = [
    layer.rate && layer.rate !== 1 ? `asetrate=${Math.round(SR * layer.rate)}` : null,
    `aresample=${SR}`,
    layer.af ?? null,
    layer.delay ? `adelay=${Math.round(layer.delay * 1000)}:all=1` : null,
  ].filter(Boolean);
  const raw = execFileSync(
    ffmpeg,
    ['-v', 'error', '-i', file, '-ac', '1', '-af', filters.join(','), '-ar', String(SR), '-f', 'f32le', '-'],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
}

/** Фильтр ffmpeg над готовым буфером (для `af` всего фрагмента после смешивания). */
function filter(ffmpeg, data, af) {
  const raw = execFileSync(
    ffmpeg,
    ['-v', 'error', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', '-', '-af', af, '-f', 'f32le', '-'],
    { input: Buffer.from(data.buffer, data.byteOffset, data.byteLength), maxBuffer: 64 * 1024 * 1024 },
  );
  return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
}

function fragment(ffmpeg, kenney, spec) {
  let data;
  if (spec.mix) {
    const layers = spec.mix.map((l) => ({ d: decode(ffmpeg, kenney, l), g: l.gain ?? 1 }));
    data = new Float32Array(Math.max(...layers.map((l) => l.d.length)));
    for (const { d, g } of layers) for (let i = 0; i < d.length; i++) data[i] += d[i] * g;
  } else data = decode(ffmpeg, kenney, spec);
  if (spec.mix && spec.af) data = filter(ffmpeg, data, spec.af);
  return trim(data);
}

/** Обрезать тишину по краям (с запасом 5 мс) и сгладить края. */
export function trim(data) {
  const thr = 10 ** (SILENCE_DB / 20);
  let a = 0;
  let b = data.length - 1;
  while (a < b && Math.abs(data[a]) < thr) a++;
  while (b > a && Math.abs(data[b]) < thr) b--;
  const m = Math.round(FADE * SR);
  return data.slice(Math.max(0, a - m), Math.min(data.length, b + m + 1));
}

/** Подъём и спад по 5 мс: фрагмент начинается и кончается в нуле. */
export function fadeEdges(data) {
  const n = Math.min(Math.round(FADE * SR), Math.floor(data.length / 2));
  for (let i = 0; i < n; i++) {
    const k = i / n;
    data[i] *= k;
    data[data.length - 1 - i] *= k;
  }
  return data;
}

function wav16(data) {
  const buf = Buffer.alloc(44 + data.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + data.length * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(data.length * 2, 40);
  for (let i = 0; i < data.length; i++)
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, data[i])) * 32767), 44 + i * 2);
  return buf;
}

function padded(f) {
  const out = new Float32Array(f.length + 2 * SR);
  out.set(f, SR);
  return out;
}

function build(ffmpeg, kenney, name, specs) {
  const frags = specs.map((s) => fragment(ffmpeg, kenney, s));
  // Выравнивание громкости фрагментов к самому тихому: файл звучит ровно, какой кусок ни выпади.
  // Каждый мерится в секунде тишины с обеих сторон, как его рендерит check:sound: у коротких кусков
  // блок LUFS 400 мс захватывает и тишину, и без этого они вышли бы тише длинных.
  const loud = frags.map((f) => lufs([padded(f)], SR));
  const target = Math.min(...loud);
  frags.forEach((f, i) => {
    const g = 10 ** ((target - loud[i] + (specs[i].boost ?? 0)) / 20);
    for (let k = 0; k < f.length; k++) f[k] *= g;
    fadeEdges(f);
  });
  const gap = Math.round(GAP * SR);
  const total = frags.reduce((s, f) => s + f.length, 0) + gap * (frags.length - 1) + 2 * Math.round(PAD * SR);
  const out = new Float32Array(total);
  const offsets = [];
  let pos = Math.round(PAD * SR);
  for (const f of frags) {
    out.set(f, pos);
    offsets.push([Math.max(0, pos / SR - PAD), f.length / SR + 2 * PAD]);
    pos += f.length + gap;
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  const g = 10 ** (PEAK_DB / 20) / peak;
  for (let i = 0; i < out.length; i++) out[i] *= g;

  const tmp = path.join(OUT, `.${name}.tmp.wav`);
  fs.writeFileSync(tmp, wav16(out));
  const mp3 = path.join(OUT, `${name}.mp3`);
  execFileSync(ffmpeg, [
    '-v',
    'error',
    '-y',
    '-i',
    tmp,
    '-ac',
    '1',
    '-ar',
    String(SR),
    '-c:a',
    'libmp3lame',
    '-b:a',
    BITRATE,
    '-map_metadata',
    '-1',
    mp3,
  ]);
  fs.rmSync(tmp, { force: true });
  const round = (v) => Math.round(v * 1000) / 1000;
  return {
    name,
    bytes: fs.statSync(mp3).size,
    seconds: round(out.length / SR),
    offsets: offsets.map(([s, l]) => [round(s), round(l)]),
    lufs: loud.map((v) => Math.round(v * 10) / 10),
    gainDb: Math.round(db(g) * 10) / 10,
  };
}

function main() {
  const ffmpeg = process.env.FFMPEG || 'ffmpeg';
  const kenney = process.env.KENNEY;
  if (!kenney) {
    console.error('Укажите KENNEY=<папка с распакованными паками Kenney> (и FFMPEG, если его нет в PATH)');
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const only = process.argv.slice(2);
  for (const [name, specs] of Object.entries(SOUNDS)) {
    if (only.length && !only.includes(name)) continue;
    const r = build(ffmpeg, kenney, name, specs);
    console.log(
      `${r.name}.mp3  ${(r.bytes / 1024).toFixed(1)} КБ  ${r.seconds} с  усиление ${r.gainDb} дБ` +
        `  громкость фрагментов до выравнивания ${r.lufs.join(' / ')} LUFS`,
    );
    if (r.offsets.length > 1) console.log(`  offsets: ${JSON.stringify(r.offsets)}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
