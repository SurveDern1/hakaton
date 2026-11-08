// Точка входа: состояние из core → GameStore → сцена Phaser (башня) и DOM-панели (#ui).
// Порядок игры: стартовый экран → GameLoop (src/game/loop.ts): утро (отчёт и окна событий) →
// день (панель, меню стройки по клику на слот) → «Завершить день» → ночь (night.ts) → утро … → финал.
// Без параметров — заставка «Включить радио» (src/ui/radio-splash.ts), если звук не выключен.
// Отладка: ?preset=<имя> — башня из набора макета без игры; ?event=<id>[,id] — окна событий сразу;
// ?tutorial=<шаг> — шаг обучения поверх новой игры (день из when.minDay).
import Phaser from 'phaser';
import { initAudio } from './audio';
import { getComic, outroFor, playComic, preloadComic } from './comics';
import { createInitialState, forecastNight, gameData, type NightReport } from './core';
import { GameLoop } from './game/loop';
import { loadGame } from './game/save';
import { GameStore } from './game/store';
import { TowerScene, type TowerSource } from './scenes/TowerScene';
import type { TowerInput } from './scenes/tower-model';
import { towerInputFromState } from './scenes/tower-model';
import { isPresetName, type PresetName, TOWER_PRESETS } from './scenes/tower-presets';
import { debugDay, initTutorial, type Tutorial } from './tutorial';
import { mountBuildMenu } from './ui/build-menu';
import { fmtSigned, mountEventWindow } from './ui/event-window';
import { flashHud, mountStatus } from './ui/feedback';
import { finalEnding, showFinal } from './ui/final';
import { h } from './ui/format';
import { mountHud } from './ui/hud';
import { playNight } from './ui/night';
import { mountPanel } from './ui/panel';
import { mountPaper } from './ui/paper';
import { showRadioSplash } from './ui/radio-splash';
import { mistNote, morningReport, showReportCard } from './ui/report';
import { showStart } from './ui/start';
import { showVerdict, verdictStats } from './ui/verdict';
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
    // На телефоне — по базовой высоте панели: раскрытая вкладка ложится поверх башни, камера не дёргается
    const base = panel.querySelector<HTMLElement>('.panel-base');
    const panelTop = base && base.offsetHeight > 0 ? base.getBoundingClientRect().top : r.top;
    return a.width < 760
      ? { top, right: 0, bottom: a.bottom - panelTop, left: 0 }
      : { top, right: r.width, bottom: 40, left: 0 };
  },
});

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#1a3437',
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
  dom: { createContainer: true },
  // Звук игры — свой движок (src/audio); звуковой менеджер Phaser создал бы AudioContext до жеста
  audio: { noAudio: true },
  scene: [towerScene],
});

const floats = h('div', { class: 'ev-floats', 'aria-hidden': 'true' });
const status = mountStatus(ui);
const flash = (key: string, delta: number) =>
  flashHud(ui, floats, key, delta, fmtSigned(delta, key as Parameters<typeof fmtSigned>[1]));

const events = mountEventWindow(ui, { store, data });
const paper = mountPaper(ui, data);

// Обучение подключается ниже, после меню стройки; утро ждёт его ворота (приветствие первого утра).
let tutorial: Tutorial | null = null;
const loop = new GameLoop(store, data, {
  async morning(queue, report: NightReport | null) {
    await tutorial?.beforeMorning(store.state.day);
    const strip = report ? morningReport(report, data, store.state) : undefined;
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
  gameMenu.replaceChildren(
    restart,
    ...(tutorial?.menuItems(() => toggleMenu(false)) ?? []),
    ...sound.menuItems(() => toggleMenu(false)),
    close,
  );
  // Открыто мышью — без рамки фокуса на первом пункте; с клавиатуры браузер её покажет сам
  restart.focus({ focusVisible: false } as FocusOptions);
}
gameMenu.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') toggleMenu(false);
});

const hud = mountHud(ui, {
  store,
  data,
  actions: [sound.hudButton()],
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
// Подсказки первых дней и по случаю (src/tutorial): наблюдают экран, состояние игры не меняют.
tutorial = initTutorial({ root: ui, store, loop, data, status });

towerScene.setSlotHandler((tier, slot, el) => menu.open(tier, slot, el));
loop.onPhase((phase) => {
  document.body.dataset.phase = phase;
  hud.inert = phase !== 'day';
  if (phase === 'final') void showEnding();
});

// Финал: эпилог-комикс концовки (data/comics.json, outro_<id> или общий outro), экран итога
// «Вы выжили!» / «Вы умерли…» (verdict концовки в data/endings.json), затем итоги
async function showEnding() {
  const state = store.state;
  const id = finalEnding(state, data).id;
  const outro = outroFor(id);
  if (outro) await playComic(ui as HTMLElement, outro);
  const kind = data.endings.endings.find((e) => e.id === id)?.verdict;
  if (kind)
    await showVerdict(ui as HTMLElement, kind, data.endings.verdicts[kind], verdictStats(state, kind));
  showFinal(ui as HTMLElement, state, { data, onRestart: () => void loop.newGame() });
}

// Новая партия со стартового экрана: сначала пролог-комикс (его можно пропустить)
async function newGameWithIntro() {
  const intro = getComic('intro');
  if (intro) await playComic(ui as HTMLElement, intro);
  ui?.classList.remove('is-bare');
  void loop.newGame();
}

// Открытие по ссылке: заставка «Включить радио» (если звук не выключен), затем стартовый экран
async function openGame() {
  ui?.classList.add('is-bare');
  if (sound.engine.settings.muted || sound.engine.ready) return start(false);
  sound.holdStartMusic();
  const how = await showRadioSplash(ui as HTMLElement, {
    onRadio: () => sound.engine.resume(),
    onSilent: () => sound.engine.update({ muted: true }),
  });
  start(how === 'radio');
}

function start(radio = false) {
  ui?.classList.add('is-bare');
  // Пока игрок на стартовом экране, картинки пролога успевают загрузиться
  const intro = getComic('intro');
  if (intro) preloadComic(intro);
  const layer = showStart(ui as HTMLElement, {
    data,
    radio,
    saved: loadGame(),
    onSettings: () => sound.openSettings(),
    onNew: () => void newGameWithIntro(),
    onContinue: (state) => {
      ui?.classList.remove('is-bare');
      loop.continueGame(state);
      status.say(`Продолжаем: день ${state.day}`, 'info');
    },
  });
  const call = layer.querySelector<HTMLElement>('.start-call');
  if (radio && call) sound.radioIntro(call);
}

// Проверка комикса: ?comic=intro, ?comic=outro_harbor — после него стартовый экран.
const debugComic = getComic(params.get('comic') ?? '');
// Проверка экрана итога: ?verdict=win или ?verdict=lose — после него стартовый экран.
const debugVerdict = params.get('verdict');
// Проверка окна без цикла: ?event=d02_raft или ?event=d01_first_morning,d02_raft (до двух окон);
// день — из события (или &day=17), &flags=a,b — с флагами.
const eventIds = params.get('event')?.split(',').filter(Boolean) ?? [];
// Проверка шага обучения: ?tutorial=build — новая игра (утренний шаг) или день из when.minDay,
// остальные шаги считаются пройденными, прогресс не записывается.
const debugStep = tutorial.debug(params.get('tutorial') ?? '');
// Звуковая лаборатория: ?sound=lab — все звуки кнопками, индикаторы, sedmaya.sound.lab.measure().
if (params.get('sound') === 'lab') {
  ui.classList.add('is-bare');
  void import('./audio/lab').then((m) => {
    sound.lab = m.mountLab(ui, sound);
  });
} else if (presetInput) {
  ui.classList.add('is-bare', 'is-preset');
} else if (debugVerdict === 'win' || debugVerdict === 'lose') {
  ui.classList.add('is-bare');
  // Итоги — со стартового состояния на день из &day= (по умолчанию 9)
  const demo = { ...createInitialState(data.balance), day: Number(params.get('day')) || 9 };
  const stats = verdictStats(demo, debugVerdict);
  void showVerdict(ui, debugVerdict, data.endings.verdicts[debugVerdict], stats).then(() => start());
} else if (debugComic) {
  ui.classList.add('is-bare');
  void playComic(ui, debugComic).then(() => start());
} else if (debugStep) {
  // Утренний шаг — на первом утре (окна событий), дневной — сразу днём нужного дня.
  if (debugStep.phase === 'morning') void loop.newGame();
  else loop.continueGame({ ...createInitialState(data.balance), day: debugDay(debugStep) });
  window.setTimeout(() => tutorial?.show(debugStep.id), debugStep.phase === 'morning' ? 1200 : 600);
} else if (eventIds.length) {
  const eventDay = data.events.find((e) => e.id === eventIds[0])?.day;
  const day = Number(params.get('day')) || eventDay;
  const flags = params.get('flags')?.split(',').filter(Boolean) ?? [];
  store.dispatch((s) => ({ ...s, day: day || s.day, flags: [...s.flags, ...flags] }));
  void events.showMorning(eventIds);
} else {
  void openGame();
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
    // Обучение: sedmaya.tutorial.progress, .current, .show('build'), .reset(), .samples (кадры появления
    // и ухода карточки), .coach.show({ title, text }, '.panel-end') — карточка без шага.
    tutorial,
    tower: {
      scene: towerScene,
      presets: Object.keys(TOWER_PRESETS),
      preset: (name: PresetName) => showTower(TOWER_PRESETS[name]),
      show: showTower,
    },
  },
});
