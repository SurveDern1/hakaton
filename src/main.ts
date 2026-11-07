// Точка входа: состояние из core → GameStore → сцена Phaser (башня) и DOM-панели (#ui).
import Phaser from 'phaser';
import { createInitialState, gameData } from './core';
import { GameStore } from './game/store';
import { TowerScene } from './scenes/TowerScene';
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
if (ui) mountHud(ui, store, gameData.balance.calendar.firstDay);

// Для отладки из консоли браузера: window.sedmaya.store.state
Object.assign(window, { sedmaya: { store, data: gameData } });
