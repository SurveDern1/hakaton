# Седьмая — структура репозитория

Игра к хакатону на тему 7 ноября: 2D-стратегия выживания о летающей башне над Мглой.

| Путь | Что это |
|---|---|
| `TZ-sedmaya.md` | ТЗ: механики, формулы ночного расчёта, система событий, формат данных, объём MVP |
| `STORY-sedmaya.md` | Сюжет: мир, персонажи, события по дням, концовки, флаги |
| `data/balance.json` | Числа баланса: старт, двигатель, Мгла, здания, декреты, фракции |
| `data/events.json` | Все события: сюжетные `dNN_*`, отложенные `late_*`, пул `pool_*`, кризисы `crisis_*` |
| `data/endings.json` | Концовки, судьбы персонажей, кристаллы памяти |
| `tools/check-data.js` | Проверка данных: `node tools/check-data.js` |
| `src/core/` | Логика игры на чистом TypeScript, без Phaser и DOM: типы данных и состояния (`types.ts`), загрузка `data/*.json` (`data.ts`), стартовое состояние (`state.ts`), условия `requires` (`requires.ts`), генератор с сидом (`rng.ts`). Тесты рядом: `*.test.ts` |
| `src/game/store.ts` | `GameStore`: текущее состояние в браузере; сцены и панели подписываются, меняют только через `dispatch` с функцией из core |
| `src/scenes/` | Сцены Phaser: `TowerScene.ts` рисует башню и Мглу по состоянию |
| `src/ui/` | Интерфейс обычным HTML/CSS поверх canvas (`#ui`): `hud.ts` — календарь и ресурсы, `style.css` — подключает токены из `design/project/sedmaya.css` |
| `src/main.ts`, `index.html` | Точка входа: core → `GameStore` → Phaser и DOM. В консоли браузера доступно `window.sedmaya` |
| `tools/export-design.js`, `tools/dc-lite.js` | Макеты для дизайнеров и аниматоров без Claude Design. `npm run export:design` собирает из `design/project/` в `design/export/` (в git не хранится): страницу на каждый экран (компонент `Tower` вшит, открываются двойным кликом), `index.html` с превью, `catalog.html` (цвета, шрифты, 18 анимаций с живым показом и кнопкой «Показать на башне» — обводит детали на настоящей башне справа, все классы `.tw .*` с CSS — строится из `sedmaya.css`), `source/` (исходники как есть) и `sources.zip`. `npm run design` — то же на http://localhost:5174 с пересборкой и перезагрузкой страницы при каждом сохранении файлов в `design/project/`: рабочий цикл для аниматора и агента — правишь `sedmaya.css` или `*.dc.html`, сразу видишь результат. `dc-lite.js` заменяет `support.js` холста: `{{…}}`, `sc-for`, `dc-import`, `onClick/onChange`, `renderVals/setState`. Конструкцию, которой нет в `dc-lite.js`, на экспорте не отрисовать, поэтому `npm run check:design` (входит в `npm run check` и в сборку) падает на выражениях не вида `{{a.b}}`, чужих тегах и атрибутах `sc-*`/`dc-*`: добавьте её в `dc-lite.js` и в `lintTemplate` |
| `.github/workflows/deploy.yml` | Пуш в `main` → `npm run check`, сборка и выкладка на GitHub Pages; макеты для дизайнеров — в подпапке `/design/` того же сайта (`node tools/export-design.js dist/design`) |
| `design/project/` | Макеты экранов, холст Claude Design «Седьмая — макеты»: `*.dc.html` — артборды, `Tower.dc.html` — функция `renderTower(state)`, `Blocks.dc.html` — лист зданий в трёх стадиях и крупные планы ярусов, `sedmaya.css` — токены, детали башни `.tw .*` и анимации |

Правила:
- Числа меняются в `data/balance.json`, затем таблицы в ТЗ (раздел 4) приводятся в соответствие.
- Новый флаг описывается в `STORY-sedmaya.md`, раздел 9.
- После правки `data/` запускать `node tools/check-data.js`.

Разработка — Phaser 4 + TypeScript + Vite, Node 22+:

| Команда | Что делает |
|---|---|
| `npm install` | Зависимости |
| `npm run dev` | Игра на http://localhost:5173 с перезагрузкой |
| `npm run check` | Типы (`tsc`), линтер и формат (Biome), тесты (Vitest), `check-data`, `check:design` (макеты укладываются в `dc-lite.js`) — должно проходить перед каждым коммитом |
| `npm run design` | Макеты на http://localhost:5174 с перезагрузкой при правке `design/project/*`; `npm run export:design` — просто собрать в `design/export/` |
| `npm run format` | Исправить формат и порядок импортов |
| `npm run build` | Статическая сборка в `dist/` (`base: './'`, открывается из любой подпапки) |

- Правило слоёв: `src/core` не импортирует Phaser, DOM и `src/game|scenes|ui`. Формулы ночи, очередь
  событий и эффекты выборов пишутся в core чистыми функциями `(state, data, …) → state` с тестами;
  сцены и панели только показывают состояние и вызывают `store.dispatch`.
- Все числа — в `data/balance.json`, в коде их нет. Случайность — только через `src/core/rng.ts`
  с состоянием в `GameState.rng`, не `Math.random`.
- Текстовые окна (события, декреты, стенгазета, финал) делаются в `src/ui` на HTML/CSS по макетам
  из `design/project/`; Phaser рисует башню, Мглу, анимации и частицы.
- Параллельные задачи — каждая в своей ветке и своём worktree, вливаются в `main` часто.
- Макеты опубликованы в https://claude.ai/artifact/Ev5Tb85HnfCwh86g4f8Y3z. После правки файлов в
  `design/project/` их публикуют туда же, корень публикации — `design/`. Сами по себе `.dc.html`
  в браузере не открываются: им нужен `support.js` холста. Для тех, у кого нет Claude Design, те же
  макеты как обычные страницы выкладываются на https://survedern1.github.io/hakaton/design/
  (каталог токенов и анимаций, исходники, `sources.zip`).
- Башня рисуется во внутреннем масштабе `TOWER_K = 12,5` px на метр (ярус 125 px). Артборд, который
  встраивает `Tower`, задаёт `width` в этих пикселях и уменьшает их через `scale`; `hint-size` равен
  итоговому размеру. Режимы компонента: вся башня, `focus="root|tier|spire"` — крупный план яруса,
  `part="building" b="farm" stage="2"` — одно здание. Проверка без браузера: вырезать скрипт из
  `Tower.dc.html` и прогнать `renderTower` в node на всех `TOWER_PRESETS`.
