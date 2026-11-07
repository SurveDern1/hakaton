// Сборка макетов для дизайнеров без Claude Design: design/project/*.dc.html -> обычные HTML-страницы.
// Каждая страница автономна: рядом лежат sedmaya.css и dc-lite.js, компонент Tower вшит в страницу,
// двойной клик открывает её в любом браузере; CSS, размеры и токены видны в DevTools.
// Запуск: node tools/export-design.js [папка-вывода]   (по умолчанию design/export, в CI — dist/design)
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'design', 'project');
const outDir = path.resolve(process.argv[2] || path.join(root, 'design', 'export'));

const canvas = JSON.parse(fs.readFileSync(path.join(srcDir, 'canvas.json'), 'utf8'));
const read = (f) => fs.readFileSync(path.join(srcDir, f), 'utf8');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

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

fs.mkdirSync(outDir, { recursive: true });
const boards = canvas.order.map((file) => ({ file, ...canvas.boards[file], out: file.replace('.dc.html', '.html') }));
for (const b of boards) fs.writeFileSync(path.join(outDir, b.out), page(b.file));
fs.copyFileSync(path.join(srcDir, 'sedmaya.css'), path.join(outDir, 'sedmaya.css'));
fs.copyFileSync(path.join(__dirname, 'dc-lite.js'), path.join(outDir, 'dc-lite.js'));

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

const index = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Седьмая — макеты</title>
<style>
:root{--bg:#10252a;--card:#1a3437;--text:#f3e9d2;--muted:#9fb3b3;--accent:#e8743b}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,sans-serif}
main{max-width:1280px;margin:0 auto;padding:32px 24px 64px}
h1{margin:0 0 8px;font-size:32px}
p{margin:0 0 12px;color:var(--muted);max-width:70ch}
a{color:var(--accent)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(${BOX_W}px,1fr));gap:20px;margin-top:28px}
.card{display:block;color:inherit;text-decoration:none;background:var(--card);border-top:4px solid var(--accent)}
.card:hover,.card:focus-visible{outline:2px solid var(--accent)}
.shot{height:${BOX_H}px;overflow:hidden;position:relative;background:#0b1a1d}
.shot iframe{border:0;transform-origin:0 0;pointer-events:none;background:#0b1a1d}
.cap{padding:12px 14px;display:flex;flex-direction:column;gap:2px}
.cap span{color:var(--muted);font-size:13px}
.tag{align-self:flex-start;font-size:12px;color:var(--bg);background:var(--accent);padding:0 8px}
</style>
</head>
<body>
<main>
<h1>Седьмая — макеты</h1>
<p>Экраны игры. Каждый открывается как обычная страница: нажмите карточку, затем F12 — видны размеры, классы и CSS-переменные. Токены (цвета, шрифты, анимации) собраны в <a href="sedmaya.css">sedmaya.css</a>. Шрифты подгружаются из Google Fonts, нужен интернет.</p>
<div class="grid">
${cards}
</div>
</main>
</body>
</html>
`;
fs.writeFileSync(path.join(outDir, 'index.html'), index);
console.log(`Макеты: ${boards.length} стр. -> ${outDir}`);
