// Наборы состояний башни из макета (TOWER_PRESETS в design/project/Tower.dc.html) — для
// проверки вида: в игре открываются параметром ?preset=<имя>, в тестах сверяются с моделью.
// Добавлены «abandoned» (брошенный ярус в Мгле) и «start» для перехода от начала игры.
import type { TowerInput } from './tower-model';

export const TOWER_PRESETS = {
  day2: {
    altitude: 60,
    mist: 23.1,
    ether: 0.85,
    stats: { trust: 68, solidarity: 69, health: 60, order: 54 },
    tiers: [
      { kind: 'root', slots: ['core', 'catcher', null] },
      { kind: 'tier', slots: [{ b: 'housing', stage: 2 }, 'housing', 'farm'] },
      { kind: 'spire', slots: ['council', null, null] },
    ],
  },
  good: {
    altitude: 90,
    mist: 38,
    ether: 1,
    stats: { trust: 84, solidarity: 78, health: 82, order: 74 },
    tiers: [
      {
        kind: 'root',
        slots: [
          { b: 'core', stage: 3 },
          { b: 'catcher', stage: 3 },
          { b: 'catcher', stage: 2 },
        ],
      },
      {
        kind: 'tier',
        slots: [
          { b: 'housing', stage: 2 },
          { b: 'farm', stage: 3 },
          { b: 'infirmary', stage: 2 },
        ],
      },
      {
        kind: 'tier',
        slots: [
          { b: 'housing', stage: 2 },
          { b: 'farm', stage: 2 },
          { b: 'guard', stage: 2 },
        ],
      },
      {
        kind: 'spire',
        slots: [
          { b: 'council', stage: 3 },
          { b: 'radio', stage: 2 },
          { b: 'housing', stage: 1 },
        ],
      },
    ],
  },
  bad: {
    altitude: 52,
    mist: 47.5,
    ether: 0.3,
    stats: { trust: 42, solidarity: 22, health: 26, order: 24 },
    tiers: [
      { kind: 'root', slots: ['core', 'catcher', 'scrap'] },
      { kind: 'tier', slots: [{ b: 'housing', stage: 2 }, 'housing', 'farm'] },
      { kind: 'tier', slots: ['housing', 'scrap', null] },
      { kind: 'spire', slots: ['council', { b: 'guard', stage: 2 }, null] },
    ],
  },
  scars: {
    altitude: 72,
    mist: 44,
    ether: 0.7,
    stats: { trust: 62, solidarity: 48, health: 58, order: 56 },
    tiers: [
      { kind: 'root', slots: ['core', { b: 'catcher', stage: 2 }, 'scrap'] },
      { kind: 'tier', slots: [{ b: 'housing', stage: 2 }, 'farm', { b: 'infirmary', stage: 2 }] },
      { kind: 'tier', slots: ['housing', { b: 'housing', stage: 2 }, 'guard'] },
      { kind: 'spire', slots: ['council', 'radio', null] },
    ],
    scars: {
      patches: [
        [0, 0.62, 0.15],
        [1, 0.12, 0.3],
        [1, 0.78, 0.2],
        [2, 0.45, 0.25],
      ],
      stumpAt: 1,
      memorial: true,
    },
  },
  harbor: {
    altitude: 96,
    mist: 41,
    ether: 0.95,
    stats: { trust: 78, solidarity: 74, health: 76, order: 66 },
    tiers: [
      {
        kind: 'root',
        slots: [
          { b: 'core', stage: 3 },
          { b: 'catcher', stage: 3 },
          { b: 'catcher', stage: 3 },
        ],
      },
      {
        kind: 'tier',
        slots: [
          { b: 'housing', stage: 3 },
          { b: 'farm', stage: 3 },
          { b: 'infirmary', stage: 2 },
        ],
      },
      {
        kind: 'tier',
        slots: [
          { b: 'housing', stage: 2 },
          { b: 'farm', stage: 3 },
          { b: 'corner', stage: 2 },
        ],
      },
      {
        kind: 'spire',
        slots: [
          { b: 'council', stage: 3 },
          { b: 'radio', stage: 3 },
          { b: 'observatory', stage: 2 },
        ],
      },
    ],
    scars: {
      patches: [
        [1, 0.7, 0.25],
        [2, 0.2, 0.2],
      ],
      stumpAt: 1,
      memorial: true,
    },
  },
  abandoned: {
    altitude: 40,
    mist: 52,
    ether: 0.4,
    stats: { trust: 50, solidarity: 40, health: 45, order: 40 },
    tiers: [
      { kind: 'root', slots: ['core', 'catcher', 'scrap'], abandoned: true },
      { kind: 'tier', slots: [{ b: 'housing', stage: 2 }, 'housing', 'farm'] },
      { kind: 'spire', slots: ['council', null, null] },
    ],
  },
} satisfies Record<string, TowerInput>;

export type PresetName = keyof typeof TOWER_PRESETS;

export function isPresetName(v: string | null): v is PresetName {
  return v != null && Object.hasOwn(TOWER_PRESETS, v);
}
