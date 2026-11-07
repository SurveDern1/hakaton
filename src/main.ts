// Точка входа: состояние из core → GameStore → сцена Phaser (башня) и DOM-панели (#ui).
// ?preset=<имя> показывает башню из набора макета (src/scenes/tower-presets.ts) вместо состояния
// игры; переключение с плавным переходом — window.sedmaya.tower.preset('bad').
import Phaser from 'phaser';
import { createInitialState, gameData } from './core';
import { GameStore } from './game/store';
import { TowerScene, type TowerSource } from './scenes/TowerScene';
import type { TowerInput } from './scenes/tower-model';
import { towerInputFromState } from './scenes/tower-model';
import { isPresetName, type PresetName, TOWER_PRESETS } from './scenes/tower-presets';
import { mountEventWindow } from './ui/event-window';
import { mountHud } from './ui/hud';
import './scenes/tower.css';
import './ui/style.css';

const store = new GameStore(createInitialState(gameData.balance));

// Источник картинки башни: состояние игры или выбранный набор из макета
const presetParam = new URLSearchParams(location.search).get('preset');
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
  : { subscribe: (listener) => store.subscribe((s) => listener(towerInputFromState(s, gameData.balance))) };

function showTower(input: TowerInput): void {
  presetInput = input;
  for (const l of presetListeners) l(input);
}

const towerScene = new TowerScene(towerSource, {
  insets: () => ({
    top: document.querySelector('#ui .hud')?.getBoundingClientRect().bottom ?? 0,
    right: 0,
    bottom: 0,
    left: 0,
  }),
});

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#1a3437',
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
  dom: { createContainer: true },
  scene: [towerScene],
});

const ui = document.getElementById('ui');
if (!ui) throw new Error('Нет слоя #ui');
mountHud(ui, store, gameData.balance.calendar.firstDay);
const events = mountEventWindow(ui, { store, data: gameData });

// Проверка окна без движка утра: ?event=d02_raft или ?event=d01_first_morning,d02_raft (до двух окон);
// день — из события (или &day=17), &flags=a,b — с флагами.
const params = new URLSearchParams(location.search);
const eventIds = params.get('event')?.split(',').filter(Boolean) ?? [];
if (eventIds.length) {
  const eventDay = gameData.events.find((e) => e.id === eventIds[0])?.day;
  const day = Number(params.get('day')) || eventDay;
  const flags = params.get('flags')?.split(',').filter(Boolean) ?? [];
  store.dispatch((s) => ({ ...s, day: day || s.day, flags: [...s.flags, ...flags] }));
  void events.showMorning(eventIds);
}

// Для отладки из консоли браузера: window.sedmaya.store.state, window.sedmaya.events.show('d02_raft'),
// window.sedmaya.tower.preset('good')
Object.assign(window, {
  sedmaya: {
    store,
    data: gameData,
    events,
    tower: {
      scene: towerScene,
      presets: Object.keys(TOWER_PRESETS),
      preset: (name: PresetName) => showTower(TOWER_PRESETS[name]),
      show: showTower,
    },
  },
});
