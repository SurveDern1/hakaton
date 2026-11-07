// Точка входа: состояние из core → GameStore → сцена Phaser (башня) и DOM-панели (#ui).
// Порядок игры: стартовый экран → GameLoop (src/game/loop.ts): утро (отчёт и окна событий) →
// день (панель, меню стройки по клику на слот) → «Завершить день» → ночь (night.ts) → утро … → финал.
// Отладка: ?preset=<имя> — башня из набора макета без игры; ?event=<id>[,id] — окна событий сразу.
import Phaser from 'phaser';
import { initAudio } from './audio';
import { getComic, outroFor, playComic } from './comics';
import { createInitialState, forecastNight, gameData, type NightReport } from './core';
import { GameLoop } from './game/loop';
import { loadGame } from './game/save';
import { GameStore } from './game/store';
import { TowerScene, type TowerSource } from './scenes/TowerScene';
import type { TowerInput } from './scenes/tower-model';
import { towerInputFromState } from './scenes/tower-model';
import { isPresetName, type PresetName, TOWER_PRESETS } from './scenes/tower-presets';
import { mountBuildMenu } from './ui/build-menu';
import { fmtSigned, mountEventWindow } from './ui/event-window';
import { flashHud, mountStatus } from './ui/feedback';
import { finalEnding, showFinal } from './ui/final';
import { h } from './ui/format';
import { mountHud } from './ui/hud';
import { playNight } from './ui/night';
import { mountPanel } from './ui/panel';
import { mountPaper } from './ui/paper';
import { mistNote, morningReport, showReportCard } from './ui/report';
import { showStart } from './ui/start';
import './scenes/tower.css';
import './ui/style.css';
import './ui/game.css';

const data = gameData;
const store = new GameStore(createInitialState(data.balance));
const params = new URLSearchParams(location.search);

// Источник картинки башни: состояние игры или выбранный набор из макета
const presetParam = params.get('preset');
const presetListeners = new Set<(input: TowerInput) => void>();
let presetInput: TowerInput | null = isPresetName(presetParam) ? TOWER_PRESETS[presetParam] : null;
const towerSource: TowerSource = presetInput
  ? {
      subscribe(listener) {
        presetListeners.add(listener);
        if (presetInput) listener(presetInput);
        return () => presetListeners.delete(listener);
      },
    }
  : { subscribe: (listener) => store.subscribe((s) => listener(towerInputFromState(s, data.balance))) };

function showTower(input: TowerInput): void {
  presetInput = input;
  for (const l of presetListeners) l(input);
}

const ui = document.getElementById('ui');
if (!ui) throw new Error('Нет слоя #ui');
// Экран игры — портретная рамка #app (style.css); отступы башни считаются от неё, а не от окна.
const app = document.getElementById('app') ?? document.body;

// Мгла ниже кадра (башня крупно на телефоне) — табличка над панелью: сколько до неё метров
const mistBelow = h('div', { class: 'mist-below num', 'aria-hidden': 'true' });
ui.append(mistBelow);

const towerScene = new TowerScene(towerSource, {
  labels: true,
  onMistBelow: (m) => {
    mistBelow.classList.toggle('is-on', m != null);
    if (m != null) mistBelow.textContent = `Мгла ниже на ${m} м`;
  },
  insets: () => {
    const a = app.getBoundingClientRect();
    const hud = document.querySelector('#ui .hud')?.getBoundingClientRect();
    const top = hud && hud.height > 0 ? hud.bottom - a.top : 0;
    const panel = document.querySelector<HTMLElement>('#ui .panel');
    if (!panel || ui.classList.contains('is-bare')) return { top, right: 0, bottom: 0, left: 0 };
    const r = panel.getBoundingClientRect();
    return a.width < 760
      ? { top, right: 0, bottom: a.bottom - r.top, left: 0 }
      : { top, right: r.width, bottom: 40, left: 0 };
  },
});

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#1a3437',
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
  dom: { createContainer: true },
  scene: [towerScene],
});

const floats = h('div', { class: 'ev-floats', 'aria-hidden': 'true' });
const status = mountStatus(ui);
const flash = (key: string, delta: number) =>
  flashHud(ui, floats, key, delta, fmtSigned(delta, key as Parameters<typeof fmtSigned>[1]));

const events = mountEventWindow(ui, { store, data });
const paper = mountPaper(ui, data);

const loop = new GameLoop(store, data, {
  async morning(queue, report: NightReport | null) {
    const strip = report ? morningReport(report, data, store.state.day) : undefined;
    if (queue.length) await events.showMorning(queue, strip);
    else if (strip) await showReportCard(ui, strip, mistNote(store.state.altitude, store.state.mist));
  },
  night: (_report, commit) => playNight(ui, towerScene, data, store.state.day, commit),
});
const sound = initAudio({ root: ui, store, loop });

// Меню «гамбургер»: новая игра с подтверждением
const gameMenu = h('div', { class: 'paper game-menu', role: 'menu', hidden: true });
function toggleMenu(force?: boolean) {
  const open = force ?? gameMenu.hidden;
  gameMenu.hidden = !open;
  if (!open) return;
  const restart = h('button', { type: 'button', role: 'menuitem', class: 'gm-item' }, 'Новая игра');
  restart.addEventListener('click', () => {
    if (restart.dataset.sure) {
      toggleMenu(false);
      void loop.newGame();
      return;
    }
    restart.dataset.sure = '1';
    restart.textContent = 'Точно? Текущая партия пропадёт';
    restart.classList.add('is-danger');
  });
  const close = h('button', { type: 'button', role: 'menuitem', class: 'gm-item' }, 'Вернуться к игре');
  close.addEventListener('click', () => toggleMenu(false));
  gameMenu.replaceChildren(restart, ...sound.menuItems(() => toggleMenu(false)), close);
  restart.focus();
}
gameMenu.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') toggleMenu(false);
});

const hud = mountHud(ui, {
  store,
  data,
  onPaper: () => paper.open(store.state, loop.lastReport, forecastNight(store.state, data)),
  onMenu: () => toggleMenu(),
});
const panel = mountPanel(ui, { store, data, loop, status, flash });
const menu = mountBuildMenu(ui, {
  store,
  data,
  loop,
  status,
  flash,
  select: (tier, slot) => towerScene.selectSlot(tier, slot),
});
ui.append(gameMenu, floats);

towerScene.setSlotHandler((tier, slot, el) => menu.open(tier, slot, el));
loop.onPhase((phase) => {
  document.body.dataset.phase = phase;
  hud.inert = phase !== 'day';
  if (phase === 'final') void showEnding();
});

// Финал: эпилог-комикс концовки (data/comics.json, outro_<id> или общий outro), затем итоги
async function showEnding() {
  const state = store.state;
  const outro = outroFor(finalEnding(state, data).id);
  if (outro) await playComic(ui as HTMLElement, outro);
  showFinal(ui as HTMLElement, state, { data, onRestart: () => void loop.newGame() });
}

// Новая партия со стартового экрана: сначала пролог-комикс (его можно пропустить)
async function newGameWithIntro() {
  const intro = getComic('intro');
  if (intro) await playComic(ui as HTMLElement, intro);
  ui?.classList.remove('is-bare');
  void loop.newGame();
}

function start() {
  ui?.classList.add('is-bare');
  showStart(ui as HTMLElement, {
    data,
    saved: loadGame(),
    onSettings: () => sound.openSettings(),
    onNew: () => void newGameWithIntro(),
    onContinue: (state) => {
      ui?.classList.remove('is-bare');
      loop.continueGame(state);
      status.say(`Продолжаем: день ${state.day}`, 'info');
    },
  });
}

// Проверка комикса: ?comic=intro, ?comic=outro_harbor — после него стартовый экран.
const debugComic = getComic(params.get('comic') ?? '');
// Проверка окна без цикла: ?event=d02_raft или ?event=d01_first_morning,d02_raft (до двух окон);
// день — из события (или &day=17), &flags=a,b — с флагами.
const eventIds = params.get('event')?.split(',').filter(Boolean) ?? [];
if (presetInput) {
  ui.classList.add('is-bare', 'is-preset');
} else if (debugComic) {
  ui.classList.add('is-bare');
  void playComic(ui, debugComic).then(start);
} else if (eventIds.length) {
  const eventDay = data.events.find((e) => e.id === eventIds[0])?.day;
  const day = Number(params.get('day')) || eventDay;
  const flags = params.get('flags')?.split(',').filter(Boolean) ?? [];
  store.dispatch((s) => ({ ...s, day: day || s.day, flags: [...s.flags, ...flags] }));
  void events.showMorning(eventIds);
} else {
  start();
}

// Для отладки из консоли браузера: window.sedmaya.store.state, window.sedmaya.loop.endDay(),
// window.sedmaya.events.show('d02_raft'), window.sedmaya.tower.preset('good')
Object.assign(window, {
  sedmaya: {
    store,
    data,
    loop,
    events,
    panel,
    comic: (id: string) => {
      const c = getComic(id);
      return c ? playComic(ui, c) : Promise.resolve();
    },
    sound,
    tower: {
      scene: towerScene,
      presets: Object.keys(TOWER_PRESETS),
      preset: (name: PresetName) => showTower(TOWER_PRESETS[name]),
      show: showTower,
    },
  },
});
