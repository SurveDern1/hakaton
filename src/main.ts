// Точка входа: состояние из core → GameStore → сцена Phaser (башня) и DOM-панели (#ui).
import Phaser from 'phaser';
import { createInitialState, gameData } from './core';
import { GameStore } from './game/store';
import { TowerScene } from './scenes/TowerScene';
import { mountEventWindow } from './ui/event-window';
import { mountHud } from './ui/hud';
import './ui/style.css';

const store = new GameStore(createInitialState(gameData.balance));

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#1a3437',
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
  scene: [new TowerScene(store)],
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

// Для отладки из консоли браузера: window.sedmaya.store.state, window.sedmaya.events.show('d02_raft')
Object.assign(window, { sedmaya: { store, data: gameData, events } });
