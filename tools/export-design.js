// Сборка макетов для дизайнеров без Claude Design: design/project/*.dc.html -> обычные HTML-страницы.
// Выход: страницы экранов, index.html (превью), catalog.html (токены, анимации, классы деталей из sedmaya.css),
// source/ (исходники как есть) и sources.zip. Страницы автономны: рядом sedmaya.css и dc-lite.js,
// компонент Tower вшит в страницу, открываются двойным кликом; CSS и размеры видны в DevTools.
// Запуск:
//   node tools/export-design.js [папка]     сборка (по умолчанию design/export, в CI — dist/design)
//   node tools/export-design.js --serve     сервер http://localhost:5174 с пересборкой и перезагрузкой по правке
//                                           design/project/* и tools/dc-lite.js (npm run design)
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'design', 'project');
const REPO = process.env.GITHUB_REPOSITORY || 'SurveDern1/hakaton';

const read = (f) => fs.readFileSync(path.join(srcDir, f), 'utf8');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- страницы экранов ----------

// Шаблон и скрипт компонента из <name>.dc.html
function component(name) {
  const html = read(`${name}.dc.html`);
  const tpl = /<x-dc>([\s\S]*?)<\/x-dc>/.exec(html);
  const js = /<script type="text\/x-dc" data-dc-script[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!tpl) throw new Error(`${name}.dc.html: нет <x-dc>`);
  for (const part of [tpl[1], js?.[1] || '']) {
    if (/<\/script/i.test(part)) throw new Error(`${name}.dc.html: </script внутри компонента`);
  }
  return (
    `<script type="text/x-dc-template" data-name="${name}">${tpl[1]}</script>\n` +
    `<script type="text/x-dc-logic" data-name="${name}">${js ? js[1] : ''}</script>\n`
  );
}

function page(file) {
  let html = read(file);
  const used = [...new Set([...html.matchAll(/<dc-import name="(\w+)"/g)].map((m) => m[1]))];
  const embedded = used.map(component).join('');
  if (!html.includes('<script src="./support.js"></script>')) throw new Error(`${file}: нет support.js`);
  html = html.replace('<script src="./support.js"></script>', `${embedded}<script src="./dc-lite.js"></script>`);
  // Ссылки между экранами: Paper.dc.html -> Paper.html
  return html.replace(/(\w+)\.dc\.html/g, '$1.html');
}

// ---------- проверка: только то, что понимает dc-lite ----------

// Возвращает список проблем в шаблоне. Всё, чего нет в dc-lite.js, на выгрузке молча не отрисуется.
function lintTemplate(label, tpl) {
  const bad = [];
  for (const m of tpl.matchAll(/\{\{([^}]*)\}\}/g)) {
    if (!/^\s*[\w$.]+\s*$/.test(m[1])) bad.push(`${label}: выражение {{${m[1]}}} — dc-lite понимает только путь вида a.b`);
  }
  for (const m of tpl.matchAll(/<([a-zA-Z][\w-]*)([^>]*)>/g)) {
    const tag = m[1].toLowerCase();
    if (tag.includes('-') && !['sc-for', 'dc-import', 'x-dc'].includes(tag)) {
      bad.push(`${label}: тег <${tag}> не поддерживается`);
    }
    for (const a of m[2].matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
      const name = a[1].toLowerCase();
      const val = a[3] ?? a[4];
      if (/^on[a-z]+$/.test(name) && !/^\{\{\s*[\w$.]+\s*\}\}$/.test(val)) {
        bad.push(`${label}: <${tag} ${name}> — обработчик должен быть целиком {{имя}}`);
      }
      if (/^(sc|dc)-/.test(name)) bad.push(`${label}: атрибут ${name} не поддерживается`);
      if (tag === 'sc-for' && !['list', 'as', 'hint-placeholder-count'].includes(name)) bad.push(`${label}: у <sc-for> нет атрибута ${name}`);
      if (tag === 'sc-for' && name === 'list' && !/^\{\{\s*[\w$.]+\s*\}\}$/.test(val)) {
        bad.push(`${label}: <sc-for list> должен быть целиком {{имя}}`);
      }
    }
  }
  return bad;
}

function lint() {
  const canvas = JSON.parse(read('canvas.json'));
  const problems = [];
  const comps = new Set();
  for (const file of canvas.order) {
    const html = read(file);
    const tpl = /<x-dc>([\s\S]*?)<\/x-dc>/.exec(html);
    if (!tpl) problems.push(`${file}: нет <x-dc>`);
    else problems.push(...lintTemplate(file, tpl[1]));
    for (const m of html.matchAll(/<dc-import name="(\w+)"/g)) comps.add(m[1]);
  }
  for (const name of comps) {
    const tpl = /<x-dc>([\s\S]*?)<\/x-dc>/.exec(read(`${name}.dc.html`));
    if (tpl) problems.push(...lintTemplate(`${name}.dc.html`, tpl[1]));
  }
  return problems;
}

// ---------- разбор sedmaya.css для каталога ----------

function parseCss(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const tokens = [];
  const rootBlock = /:root\s*\{([^}]*)\}/.exec(clean);
  for (const m of (rootBlock?.[1] || '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokens.push([m[1], m[2].trim()]);

  const keyframes = [];
  for (const m of clean.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)) {
    keyframes.push({ name: m[1], body: m[2].trim().replace(/\s+/g, ' ') });
  }
  const body = clean.replace(/@keyframes\s+[\w-]+\s*\{(?:[^{}]|\{[^{}]*\})*\}/g, '');

  const rules = [];
  for (const m of body.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim();
    if (sel) rules.push({ sel, decl: m[2].trim() });
  }

  const usage = new Map();
  for (const r of rules) {
    const a = /(?:^|;|\s)animation\s*:\s*([^;]+)/.exec(r.decl);
    if (!a) continue;
    for (const part of a[1].split(/,(?![^(]*\))/)) {
      const [name, ...rest] = part.trim().split(/\s+/);
      if (!keyframes.some((k) => k.name === name)) continue;
      if (!usage.has(name)) usage.set(name, { sels: [], spec: rest.join(' ') });
      usage.get(name).sels.push(r.sel);
    }
  }

  const classes = new Map();
  for (const r of rules) {
    for (const sel of r.sel.split(',')) {
      const m = /\.tw\s+\.([\w-]+)/.exec(sel);
      if (!m) continue;
      if (!classes.has(m[1])) classes.set(m[1], []);
      classes.get(m[1]).push(`${r.sel} {\n  ${r.decl.replace(/;\s*/g, ';\n  ').trim()}\n}`);
      break;
    }
  }
  return { tokens, keyframes, usage, classes };
}

const SHELL_CSS = `:root{--bg:#10252a;--card:#1a3437;--c-text:#f3e9d2;--c-muted:#9fb3b3;--accent:#e8743b}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--c-text);font:16px/1.5 system-ui,sans-serif}
main{max-width:1280px;margin:0 auto;padding:32px 24px 64px}
h1{margin:0 0 8px;font-size:32px}h2{margin:40px 0 12px;font-size:22px}
p{margin:0 0 12px;color:var(--c-muted);max-width:75ch}
a{color:var(--accent)}code,pre{font-family:ui-monospace,Consolas,monospace;font-size:13px}
nav{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:20px}`;

function catalog(css) {
  const { tokens, keyframes, usage, classes } = parseCss(css);

  const swatches = tokens
    .filter(([, v]) => /^#|^rgb/.test(v))
    .map(
      ([n, v]) =>
        `<div class="sw"><i style="background:${esc(v)}"></i><b>${esc(n)}</b><span>${esc(v)}</span></div>`,
    )
    .join('');
  const fonts = tokens
    .filter(([n]) => n.startsWith('--f-'))
    .map(
      ([n, v]) =>
        `<div class="font"><span style="font-family:${esc(v)}">Седьмое ноября · 0123456789</span><code>${esc(n)}: ${esc(v)}</code></div>`,
    )
    .join('');

  const anims = keyframes
    .map((k) => {
      const u = usage.get(k.name);
      const spec = u ? u.spec : '2s ease-in-out infinite';
      const sels = u ? [...new Set(u.sels)].map((s) => `<code>${esc(s)}</code>`).join(' ') : '<em>не привязана</em>';
      const dataSels = esc(JSON.stringify(u ? [...new Set(u.sels)] : []));
      return `<div class="anim" data-sels="${dataSels}"><div class="stage"><i style="animation:${esc(k.name)} ${esc(spec)}"></i></div>
<div><b>${esc(k.name)}</b> <code>${esc(spec)}</code><div class="sels">${sels}</div>
<button type="button" class="show" hidden>Показать на башне</button>
<span class="none" hidden>на этой башне такой детали нет</span>
<details><summary>keyframes</summary><pre>@keyframes ${esc(k.name)} { ${esc(k.body)} }</pre></details></div></div>`;
    })
    .join('\n');

  const cls = [...classes.entries()]
    .map(([name, list]) => {
      const animated = list.some((r) => /animation\s*:/.test(r)) ? ' <span class="tag">анимация</span>' : '';
      return `<details class="cls" data-n="${esc(name)}"><summary><code>.tw .${esc(name)}</code>${animated}</summary><pre>${esc(list.join('\n\n'))}</pre></details>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Седьмая — каталог</title>
<link rel="stylesheet" href="sedmaya.css">
<style>
${SHELL_CSS}
.split{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:20px;align-items:start}
.towerbox{position:sticky;top:12px;background:#0b1a1d;border-top:4px solid var(--accent);padding:8px;overflow:hidden}
.towerbox h3{margin:0 0 6px;font-size:14px;font-weight:600}
.towerview{width:324px;height:660px;overflow:hidden}
.show{font:inherit;font-size:13px;color:var(--bg);background:var(--accent);border:0;padding:2px 10px;cursor:pointer}
.none{font-size:13px;color:var(--c-muted)}
.anim.on{outline:2px solid var(--accent)}
@media (max-width:900px){.split{grid-template-columns:1fr}.towerbox{position:static}}
.sws{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px}
.sw{display:flex;flex-direction:column;background:var(--card);padding:8px;font-size:13px}
.sw i{height:44px;margin-bottom:6px;border:1px solid #fff2}.sw span{color:var(--c-muted)}
.font{background:var(--card);padding:10px 14px;margin-bottom:8px;display:flex;flex-direction:column;gap:2px}
.font span{font-size:22px}
.anim{display:flex;gap:16px;background:var(--card);padding:12px;margin-bottom:8px;align-items:flex-start;--lift:30px;--fall:50px;--walk:30px}
.stage{flex:none;width:140px;height:80px;background:#0b1a1d;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative}
.stage i{display:block;width:34px;height:34px;border-radius:6px;background:var(--accent);transform-origin:50% 0}
.sels{margin:4px 0}.sels code{display:inline-block;margin:0 6px 2px 0;color:var(--c-muted)}
.cls{background:var(--card);margin-bottom:4px;padding:6px 12px}.cls summary{cursor:pointer}
pre{margin:8px 0 4px;white-space:pre-wrap;word-break:break-word;color:#d7e4e1}
.tag{font-size:12px;color:var(--bg);background:var(--accent);padding:0 8px}
#q{width:100%;max-width:420px;padding:8px 10px;font:inherit;background:var(--card);color:var(--c-text);border:1px solid #fff3}
@media (prefers-reduced-motion:reduce){.stage i{animation:none!important}}
</style>
</head>
<body>
<main>
<nav><a href="index.html">← Макеты</a><a href="source/sedmaya.css">sedmaya.css</a><a href="sources.zip">Все исходники (zip)</a></nav>
<h1>Каталог: токены, анимации, детали</h1>
<p>Собирается из <code>design/project/sedmaya.css</code> при каждой сборке: правка файла сразу меняет каталог. Деталь башни — класс <code>.tw .имя</code>; как они выглядят на экранах, смотрите в «Блоки: здания» и «Состояния башни». Оранжевый квадрат в примерах показывает только кривую и время; на экранах та же анимация крутит реальные детали.</p>
<h2>Цвета</h2><div class="sws">${swatches}</div>
<h2>Шрифты</h2>${fonts}
<h2>Анимации (${keyframes.length})</h2>
<p>Каждая крутится с теми же временем и кривой, что в CSS. При <code>prefers-reduced-motion</code> движения нет. «Показать на башне» обводит на живой башне справа детали, которые используют эту анимацию.</p>
<div class="split"><div>
${anims}
</div><aside class="towerbox"><h3>Башня (preset good)</h3><div class="towerview">
<x-dc><dc-import name="Tower" preset="good" width="900" topm="152" scale="0.36"></dc-import></x-dc>
</div></aside></div>
<h2>Классы деталей башни (${classes.size})</h2>
<p><input id="q" type="search" placeholder="Поиск по имени класса" aria-label="Поиск по имени класса"></p>
<div id="cls">${cls}</div>
</main>
${component('Tower')}<script src="./dc-lite.js"></script>
<script>
document.addEventListener('DOMContentLoaded', function () {
  var tower = document.querySelector('.towerview');
  var hl = document.createElement('style');
  document.head.appendChild(hl);
  function found(sels) {
    return sels.some(function (s) {
      try { return !!tower.querySelector(s.replace(/^\\s*\\.tw\\s+/, '.tw ')); } catch (e) { return false; }
    });
  }
  document.querySelectorAll('.anim').forEach(function (card) {
    var sels = JSON.parse(card.dataset.sels || '[]');
    var btn = card.querySelector('.show');
    var none = card.querySelector('.none');
    if (found(sels)) btn.hidden = false; else if (sels.length) none.hidden = false;
    btn.addEventListener('click', function () {
      var on = card.classList.contains('on');
      document.querySelectorAll('.anim.on').forEach(function (c) { c.classList.remove('on'); });
      hl.textContent = '';
      if (on) return;
      card.classList.add('on');
      hl.textContent = sels.map(function (s) { return '.towerview ' + s; }).join(',') +
        '{outline:2px solid #fff;outline-offset:3px;box-shadow:0 0 0 5px rgba(232,116,59,.8)!important}';
    });
  });
});
document.getElementById('q').addEventListener('input', function (e) {
  var v = e.target.value.trim().toLowerCase();
  document.querySelectorAll('.cls').forEach(function (d) { d.hidden = v && d.dataset.n.toLowerCase().indexOf(v) < 0; });
});
</script>
</body>
</html>
`;
}

// ---------- zip (store/deflate, без зависимостей) ----------

function zip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const comp = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 имена
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(comp.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nameBuf.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, nameBuf);
    offset += local.length + nameBuf.length + comp.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, end]);
}

// ---------- сборка ----------

function build(outDir) {
  const problems = lint();
  if (problems.length) throw new Error(`макеты используют то, чего нет в dc-lite.js:\n  ${problems.join('\n  ')}`);
  const canvas = JSON.parse(read('canvas.json'));
  fs.mkdirSync(path.join(outDir, 'source'), { recursive: true });
  const boards = canvas.order.map((file) => ({ file, ...canvas.boards[file], out: file.replace('.dc.html', '.html') }));
  for (const b of boards) fs.writeFileSync(path.join(outDir, b.out), page(b.file));

  const css = read('sedmaya.css');
  fs.writeFileSync(path.join(outDir, 'sedmaya.css'), css);
  fs.copyFileSync(path.join(__dirname, 'dc-lite.js'), path.join(outDir, 'dc-lite.js'));
  fs.writeFileSync(path.join(outDir, 'catalog.html'), catalog(css));

  // Исходники как есть: макеты, стили, холст; плюс скрипты сборки, чтобы пересобрать у себя
  const sources = fs.readdirSync(srcDir).filter((f) => fs.statSync(path.join(srcDir, f)).isFile());
  for (const f of sources) fs.copyFileSync(path.join(srcDir, f), path.join(outDir, 'source', f));
  const zipFiles = sources.map((f) => [`design/project/${f}`, fs.readFileSync(path.join(srcDir, f))]);
  for (const f of ['tools/export-design.js', 'tools/dc-lite.js']) {
    zipFiles.push([f, fs.readFileSync(path.join(root, f))]);
  }
  fs.writeFileSync(path.join(outDir, 'sources.zip'), zip(zipFiles));

  const BOX_W = 360;
  const BOX_H = 240;
  const cards = boards
    .map((b) => {
      const k = Math.min(BOX_W / b.w, BOX_H / b.h);
      const tag = b.is_interactive ? ' <span class="tag">двигается</span>' : '';
      return `<a class="card" href="${b.out}">
  <div class="shot"><iframe src="${b.out}" title="${esc(b.title)}" loading="lazy" tabindex="-1" scrolling="no" style="width:${b.w}px;height:${b.h}px;transform:scale(${k.toFixed(4)})"></iframe></div>
  <div class="cap"><b>${esc(b.title)}</b>${tag}<span>${b.w}×${b.h} · ${b.out}</span></div>
</a>`;
    })
    .join('\n');
  const srcLinks = sources.map((f) => `<li><a href="source/${esc(f)}">${esc(f)}</a></li>`).join('');
  const repoUrl = `https://github.com/${REPO}/tree/main/design/project`;

  const index = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Седьмая — макеты</title>
<style>
${SHELL_CSS}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(${BOX_W}px,1fr));gap:20px;margin-top:28px}
.card{display:block;color:inherit;text-decoration:none;background:var(--card);border-top:4px solid var(--accent)}
.card:hover,.card:focus-visible{outline:2px solid var(--accent)}
.shot{height:${BOX_H}px;overflow:hidden;position:relative;background:#0b1a1d}
.shot iframe{border:0;transform-origin:0 0;pointer-events:none;background:#0b1a1d}
.cap{padding:12px 14px;display:flex;flex-direction:column;gap:2px}
.cap span{color:var(--c-muted);font-size:13px}
.tag{align-self:flex-start;font-size:12px;color:var(--bg);background:var(--accent);padding:0 8px}
.src{columns:3 220px;margin:0;padding-left:18px}
</style>
</head>
<body>
<main>
<nav><a href="catalog.html">Каталог: токены, анимации, детали башни</a><a href="sources.zip">Все исходники (zip)</a><a href="${repoUrl}">Репозиторий</a></nav>
<h1>Седьмая — макеты</h1>
<p>Экраны игры. Нажмите карточку, затем F12: видны размеры, классы и CSS-переменные. Цвета, шрифты и анимации — в каталоге; шрифты подгружаются из Google Fonts, нужен интернет.</p>
<div class="grid">
${cards}
</div>
<h2>Исходники</h2>
<p>Файлы как лежат в репозитории (<code>design/project/</code>): правьте их, дальше <code>npm run design</code> — локальная страница с перезагрузкой при каждом сохранении.</p>
<ul class="src">${srcLinks}</ul>
</main>
</body>
</html>
`;
  fs.writeFileSync(path.join(outDir, 'index.html'), index);
  return boards.length;
}

// ---------- сервер с перезагрузкой ----------

function serve(port) {
  const outDir = path.join(root, 'design', 'export');
  const clients = new Set();
  const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.zip': 'application/zip' };
  const RELOAD = '<script>new EventSource("/__reload").onmessage=function(){location.reload()}</script>';
  const rebuild = () => {
    try {
      build(outDir);
      console.log(`${new Date().toLocaleTimeString()} собрано`);
      for (const res of clients) res.write('data: 1\n\n');
    } catch (e) {
      console.error(`Ошибка сборки: ${e.message}`);
    }
  };
  rebuild();
  let timer;
  const onChange = () => {
    clearTimeout(timer);
    timer = setTimeout(rebuild, 150);
  };
  fs.watch(srcDir, onChange);
  fs.watch(path.join(__dirname, 'dc-lite.js'), onChange);

  http
    .createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      if (url === '/__reload') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      const file = path.join(outDir, url === '/' ? 'index.html' : url);
      if (!file.startsWith(outDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404).end('нет такого файла');
        return;
      }
      const ext = path.extname(file);
      let body = fs.readFileSync(file);
      if (ext === '.html') body = Buffer.from(body.toString('utf8').replace('</body>', `${RELOAD}</body>`));
      res.writeHead(200, { 'content-type': `${MIME[ext] || 'application/octet-stream'}; charset=utf-8`, 'cache-control': 'no-store' });
      res.end(body);
    })
    .listen(port, () => console.log(`Макеты: http://localhost:${port}/ (правка design/project/* перезагружает страницу)`));
}

const args = process.argv.slice(2);
if (args.includes('--check')) {
  const problems = lint();
  if (problems.length) {
    console.error(`ОШИБКА: макеты используют то, чего нет в dc-lite.js:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log('макеты: конструкции поддерживаются dc-lite');
} else if (args.includes('--serve')) {
  serve(Number(process.env.PORT) || 5174);
} else {
  const outDir = path.resolve(args[0] || path.join(root, 'design', 'export'));
  console.log(`Макеты: ${build(outDir)} стр. -> ${outDir}`);
}
