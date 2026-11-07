import Phaser from 'phaser';
import type { GameState } from '../core';
import type { GameStore } from '../game/store';

// Временная отрисовка башни простыми фигурами: ярусы снизу вверх, Мгла поднимается снизу.
// Цвета — из токенов design/project/sedmaya.css.
const COLORS = {
  sky: 0x121419,
  tier: 0x262b35,
  root: 0x1a1e26,
  spire: 0x8e1c15,
  slot: 0x3a404c,
  built: 0xd99a2b,
  ether: 0x6cd4ff,
  mist: 0x8d939b,
};

const TIER_H = 70;
const TIER_W = 260;

export class TowerScene extends Phaser.Scene {
  private tower!: Phaser.GameObjects.Graphics;
  private mist!: Phaser.GameObjects.Rectangle;
  private unsubscribe?: () => void;

  constructor(private store: GameStore) {
    super('tower');
  }

  create(): void {
    this.cameras.main.setBackgroundColor(COLORS.sky);
    this.tower = this.add.graphics();
    this.mist = this.add.rectangle(0, 0, 10, 10, COLORS.mist, 0.55).setOrigin(0, 0);
    this.unsubscribe = this.store.subscribe((s) => this.draw(s));
    this.scale.on('resize', () => this.draw(this.store.state));
    this.events.once('shutdown', () => this.unsubscribe?.());
  }

  private draw(state: GameState): void {
    const { width, height } = this.scale;
    const cx = width / 2;
    // Высота 0 — низ экрана; башня стоит на своей высоте над Мглой.
    const ground = height - 40 - state.altitude;
    const g = this.tower.clear();

    state.tiers.forEach((tier, i) => {
      const top = ground - (i + 1) * TIER_H;
      const left = cx - TIER_W / 2;
      const fill = tier.kind === 'root' ? COLORS.root : tier.kind === 'spire' ? COLORS.spire : COLORS.tier;
      g.fillStyle(fill, tier.abandoned ? 0.4 : 1).fillRect(left, top, TIER_W, TIER_H - 6);
      tier.slots.forEach((slot, j) => {
        const sx = left + 12 + j * ((TIER_W - 24) / tier.slots.length);
        const sw = (TIER_W - 24) / tier.slots.length - 8;
        g.fillStyle(slot ? COLORS.built : COLORS.slot, 1).fillRect(sx, top + 14, sw, TIER_H - 34);
      });
    });

    // Ядро в Корне светится эфиром.
    g.fillStyle(COLORS.ether, 0.9).fillCircle(cx, ground - TIER_H / 2, 8);

    const mistTop = height - state.mist * 2;
    this.mist.setPosition(0, mistTop).setSize(width, height - mistTop);
  }
}
