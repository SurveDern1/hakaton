// Проверка data/*.json: уникальные id, существующие отложенные события,
// каждый читаемый флаг где-то ставится, сюжетные дни 1–20 покрыты.
// Запуск: node tools/check-data.js
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'data');
const load = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const balance = load('balance.json');
const { events } = load('events.json');
const endings = load('endings.json');

const errors = [];
const ids = new Set();
const setFlags = new Set();
const readFlags = new Map();
const STAT_KEYS = ['pop', 'food', 'ether', 'mat', 'trust', 'solidarity', 'health', 'order', 'altitude', 'mist'];
const FACTIONS = Object.keys(balance.start.factions);

function readReq(req, where) {
  if (!req) return;
  for (const k of ['flags', 'notFlags', 'anyFlags']) {
    for (const f of req[k] || []) readFlags.set(f, where);
  }
  for (const sub of req.any || []) readReq(sub, where);
  for (const f of Object.keys(req.factions || {})) {
    if (!FACTIONS.includes(f)) errors.push(`${where}: неизвестная фракция ${f}`);
  }
}

for (const e of events) {
  if (ids.has(e.id)) errors.push(`повтор id ${e.id}`);
  ids.add(e.id);
  if (!e.title || !e.text) errors.push(`${e.id}: нет title или text`);
  if (!e.choices || e.choices.length < 1 || e.choices.length > 5) errors.push(`${e.id}: choices 1–5`);
  readReq(e.requires, e.id);
  for (const x of e.extraText || []) readReq(x.requires, e.id);
  for (const c of e.choices || []) {
    readReq(c.requires, e.id);
    for (const x of c.extraEffects || []) readReq(x.requires, e.id);
    for (const f of c.setFlags || []) setFlags.add(f);
    for (const k of Object.keys(c.effects || {})) {
      if (!STAT_KEYS.includes(k)) errors.push(`${e.id}: неизвестный эффект ${k}`);
    }
    for (const k of Object.keys(c.factions || {})) {
      if (!FACTIONS.includes(k)) errors.push(`${e.id}: неизвестная фракция ${k}`);
    }
    if (c.ending && !['harbor', 'seal', 'hold'].includes(c.ending)) errors.push(`${e.id}: путь ${c.ending}`);
    if (!c.log) errors.push(`${e.id}: у варианта «${c.label}» нет log`);
  }
}

for (const e of events) {
  for (const c of e.choices || []) {
    for (const d of c.delayed || []) {
      if (!ids.has(d.event)) errors.push(`${e.id}: отложенное событие ${d.event} не найдено`);
    }
  }
}

for (const [f, where] of readFlags) {
  if (!setFlags.has(f)) errors.push(`${where}: флаг ${f} читается, но нигде не ставится`);
}

for (let d = 1; d <= balance.calendar.days; d++) {
  const story = events.filter((e) => e.day === d);
  if (!story.length) errors.push(`день ${d}: нет сюжетного события`);
  else if (story[story.length - 1].requires) {
    errors.push(`день ${d}: у последнего варианта есть requires — в какой-то партии день останется пустым`);
  }
}

for (const list of Object.values(endings.fates)) {
  for (const fate of list) for (const f of fate.flags || []) {
    if (!setFlags.has(f)) errors.push(`судьба: флаг ${f} нигде не ставится`);
  }
}
for (const x of endings.endings.flatMap((e) => e.extraText || [])) {
  for (const f of x.requires.flags || []) if (!setFlags.has(f)) errors.push(`концовка: флаг ${f} нигде не ставится`);
}

// Экраны итога: у каждой концовки verdict win|lose, картинки лежат в public/
for (const e of endings.endings) {
  if (!['win', 'lose'].includes(e.verdict)) errors.push(`концовка ${e.id}: verdict не win и не lose`);
}
for (const [k, v] of Object.entries(endings.verdicts || {})) {
  if (!fs.existsSync(path.join(__dirname, '..', 'public', v.image))) errors.push(`итог ${k}: нет файла public/${v.image}`);
}
if (!endings.verdicts?.win || !endings.verdicts?.lose) errors.push('endings.json: нужны verdicts.win и verdicts.lose');

// Комиксы: картинки кадров лежат в public/ (сетки и эпилоги проверяет src/comics/comics.test.ts)
const comics = load('comics.json');
for (const c of comics.comics) {
  for (const page of c.pages) for (const panel of page.panels) {
    if (panel.image && !fs.existsSync(path.join(__dirname, '..', 'public', panel.image))) {
      errors.push(`комикс ${c.id}: нет файла public/${panel.image}`);
    }
  }
}

// Звуки из файлов: каждый `file` манифеста src/audio/samples.ts лежит в public/ и записан в CREDITS.md,
// лишних mp3 нет, вся папка public/sounds/ не больше 300 КБ. Отметки фрагментов и громкость меряет
// check:sound. samples.ts импортирует Web Audio, поэтому манифест читается как текст.
const SOUNDS_MAX_KB = 300;
const samplesSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'audio', 'samples.ts'), 'utf8');
const soundFiles = [...samplesSrc.matchAll(/file:\s*'([^']+)'/g)].map((m) => m[1]);
for (const f of soundFiles) {
  if (f.startsWith('/')) errors.push(`звук ${f}: путь без ведущего / (сайт открывается из подпапки)`);
  else if (!fs.existsSync(path.join(__dirname, '..', 'public', f))) errors.push(`звук: нет файла public/${f}`);
}
const soundsDir = path.join(__dirname, '..', 'public', 'sounds');
if (fs.existsSync(soundsDir)) {
  const kb = fs.readdirSync(soundsDir).reduce((s, f) => s + fs.statSync(path.join(soundsDir, f)).size, 0) / 1024;
  if (kb > SOUNDS_MAX_KB) errors.push(`public/sounds/: ${kb.toFixed(0)} КБ, больше ${SOUNDS_MAX_KB} КБ`);
  for (const f of fs.readdirSync(soundsDir).filter((n) => n.endsWith('.mp3')))
    if (!soundFiles.includes(`sounds/${f}`)) errors.push(`public/sounds/${f}: файла нет в манифесте samples.ts`);
  const credits = path.join(soundsDir, 'CREDITS.md');
  const creditsText = fs.existsSync(credits) ? fs.readFileSync(credits, 'utf8') : '';
  for (const f of soundFiles)
    if (!creditsText.includes(path.basename(f))) errors.push(`звук ${f}: нет строки в public/sounds/CREDITS.md`);
}
console.log(`звуков из файлов: ${soundFiles.length}`);

// Обучение: та же проверка, что в src/tutorial/tutorial.test.ts. schema.ts без импортов во время
// выполнения, поэтому Node подключает его сам, снимая типы.
const { checkTutorial } = require('../src/tutorial/schema.ts');
const tutorial = load('tutorial.json');
for (const e of checkTutorial(tutorial, balance)) errors.push(`обучение: ${e}`);

const unused = [...setFlags].filter((f) => !readFlags.has(f) && !JSON.stringify(endings).includes(`"${f}"`));
console.log(`шагов обучения: ${tutorial.steps.length}`);
console.log(`событий: ${events.length}, флагов ставится: ${setFlags.size}, читается: ${readFlags.size}`);
if (unused.length) console.log(`флаги без чтения (для эпилога и будущих событий): ${unused.join(', ')}`);
if (errors.length) {
  console.error(errors.map((x) => `ОШИБКА: ${x}`).join('\n'));
  process.exit(1);
}
console.log('данные в порядке');
