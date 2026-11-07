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
| `.github/workflows/deploy.yml` | Пуш в `main` → `npm run check`, сборка и выкладка на GitHub Pages |
| `design/project/` | Макеты экранов, холст Claude Design «Седьмая — макеты»: `*.dc.html` — артборды, `Tower.dc.html` — функция `renderTower(state)`, `sedmaya.css` — токены и анимации |

Правила:
- Числа меняются в `data/balance.json`, затем таблицы в ТЗ (раздел 4) приводятся в соответствие.
- Новый флаг описывается в `STORY-sedmaya.md`, раздел 9.
- После правки `data/` запускать `node tools/check-data.js`.

Разработка — Phaser 4 + TypeScript + Vite, Node 22+:

| Команда | Что делает |
|---|---|
| `npm install` | Зависимости |
| `npm run dev` | Игра на http://localhost:5173 с перезагрузкой |
| `npm run check` | Типы (`tsc`), линтер и формат (Biome), тесты (Vitest), `check-data` — должно проходить перед каждым коммитом |
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
  в браузере не открываются: им нужен `support.js` холста.
