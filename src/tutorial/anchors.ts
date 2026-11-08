// Договор обучения с экраном: имя якоря (schema.ts → ANCHORS) → где элемент в рамке #app (#ui и
// кнопки слотов башни в DOMElement Phaser). Экран меняют
// параллельные задачи — поэтому все селекторы здесь и только здесь. У якоря несколько селекторов:
// берётся первый видимый элемент. Не нашёлся — карточка по центру без стрелки и предупреждение в
// консоли (findAnchor), обучение не ломается.
import type { TutorialAnchor } from './schema';

/** Селекторы якоря по порядку; `{mistTier}` — номер первого яруса во Мгле (index.ts подставляет). */
export const ANCHOR_SELECTORS: Record<TutorialAnchor, readonly string[]> = {
  center: [],
  // Окно события (src/ui/event-window.ts): стрелки — рамка вокруг всех ответов, чтобы карточка ложилась
  // над ними или под ними и не закрывала ни один; ⧗, легенда, отчёт о ночи
  event_arrows: ['.ev-layer:not(.is-chosen) .ev-choices', '.ev-layer .ev-hints'],
  event_memory: ['.ev-layer:not(.is-chosen) .hint.memory'],
  event_legend: ['.ev-layer .ev-legend'],
  event_report: ['.ev-layer .ev-report', '.report-card .report-list'],
  event_locked: [
    '.ev-layer:not(.is-chosen) .ev-choice.is-locked',
    '.ev-layer:not(.is-chosen) .ev-choice.is-off',
  ],
  // Шапка (src/ui/hud.ts)
  hud_resources: ['.hud .hud-tiles'],
  hud_altitude: ['.hud .hud-tile[data-key="altitude"]'],
  hud_mist: ['.hud .hud-tile[data-key="mist"]', '.mist-below.is-on'],
  hud_menu: ['.hud .hud-paper', '.hud .ibtn[aria-haspopup="menu"]'],
  // Башня (src/scenes/tower-dom.ts): кнопки слотов поверх DOMElement Phaser
  tower: ['.tw-hits'],
  slot_root_empty: ['.tw-hit.is-empty[data-tier="0"]', '.tw-hit.is-empty'],
  tier_in_mist: ['.tw-hit[data-tier="{mistTier}"]'],
  // Меню стройки (src/ui/build-menu.ts)
  build_menu: ['.bmenu:not([hidden])'],
  // Панель (src/ui/panel.ts): вкладки телефона и устойчивые секции (содержимое перерисовывается)
  tab_stats: ['.panel .tab[data-tab="stats"]'],
  tab_factions: ['.panel .tab[data-tab="factions"]'],
  tab_decrees: ['.panel .tab[data-tab="decrees"]'],
  tab_night: ['.panel .tab[data-tab="night"]'],
  stats: ['.panel-sec[data-tab="stats"]'],
  factions: ['.panel-sec[data-tab="factions"]'],
  decrees: ['.panel-sec[data-tab="decrees"]'],
  night_forecast: ['.panel-forecast .fc-grid', '.panel-forecast'],
  engine_modes: ['.panel-forecast .modes'],
  new_tier: ['.panel-tower .tower-row', '.panel-tower'],
  end_day: ['.panel-end'],
  end_warn: ['.panel-warn'],
};

/**
 * Что карточка обходит, кроме своей цели: лист меню стройки, табличку «Мгла ниже на N м» (src/main.ts) и
 * поднятую нижнюю панель телефона (вкладки «Декреты», «Ночь»): иначе карточка ложится на её кнопки.
 * Строка статуса стоит над карточкой (tutorial.css), а реплика персонажа — повод подождать с новой
 * карточкой (index.ts, REPLY_SELECTOR): от коротких плашек карточка не прыгает.
 */
export const AVOID_SELECTORS: readonly string[] = [
  '.bmenu:not([hidden])',
  '#ui > .mist-below.is-on',
  '#ui.is-panel-up > .panel',
];

/** Реплика персонажа после ответа (src/ui/event-window.ts): пока она видна, новая карточка ждёт. */
export const REPLY_SELECTOR = '.ev-reply:not(.is-leaving)';

/** Селекторы якоря с подстановкой: `{mistTier}` → номер яруса; нет яруса — селектор отбрасывается. */
export function anchorSelectors(name: string, vars: { mistTier?: number | null } = {}): string[] {
  const list = ANCHOR_SELECTORS[name as TutorialAnchor];
  if (!list) return [];
  return list.flatMap((sel) => {
    if (!sel.includes('{mistTier}')) return [sel];
    return vars.mistTier == null ? [] : [sel.replaceAll('{mistTier}', String(vars.mistTier))];
  });
}

const visible = (e: Element) => {
  const r = e.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

/** Первый видимый элемент якоря в root; `center` и ненайденный — null. */
export function queryAnchor(
  root: ParentNode,
  name: string,
  vars: { mistTier?: number | null } = {},
): Element | null {
  for (const sel of anchorSelectors(name, vars)) {
    for (const e of root.querySelectorAll(sel)) if (visible(e)) return e;
  }
  return null;
}

const warned = new Set<string>();

/** Как queryAnchor, но о ненайденном якоре один раз скажет в консоли. */
export function findAnchor(
  root: ParentNode,
  name: string,
  vars: { mistTier?: number | null } = {},
): Element | null {
  if (name === 'center') return null;
  const e = queryAnchor(root, name, vars);
  if (!e && !warned.has(name)) {
    warned.add(name);
    console.warn(`[обучение] якорь «${name}» не найден на экране — карточка по центру`);
  }
  if (e) warned.delete(name);
  return e;
}
