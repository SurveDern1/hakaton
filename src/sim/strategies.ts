// Стратегии прогона (ТЗ 14): «милосердный», «жёсткий», «ничего не строит» и случайный игрок.
// Веса — насколько стратегии важен каждый показатель при выборе варианта события.
import type { Strategy } from './sim';

export const merciful: Strategy = {
  id: 'merciful',
  name: 'Милосердный',
  weights: {
    stats: { trust: 1.5, solidarity: 2, health: 1.5, order: 0.3 },
    res: { pop: 2, food: 0.3, ether: 0.3, mat: 0.2 },
    factions: { mistborn: 0.3, stokers: 0.2, institute: 0.1, sky: 0.1 },
  },
  prefer: { d02_raft: 0, d05_quarantine: 0, d07_sermon: 1, d16_price: 0, d19_conductor: 4 },
  flags: { told_truth: 5, ia_trust: 5, marta_respect: 3, harbor_course: 3, dropped_lower: -50 },
  final: ['harbor', 'seal', 'hold'],
  manages: true,
  extraBuilds: ['infirmary', 'housing'],
  decrees: ['equal_rations'],
};

export const harsh: Strategy = {
  id: 'harsh',
  name: 'Жёсткий',
  weights: {
    stats: { trust: 0.3, solidarity: 0.1, health: 0.5, order: 2 },
    res: { pop: 0.2, food: 0.5, ether: 0.8, mat: 0.6 },
    factions: { stokers: 0.2, institute: 0.2, mistborn: 0, sky: 0 },
    altitude: 0.5,
  },
  prefer: { d02_raft: 2, d05_quarantine: 2, d07_sermon: 2, d16_price: 2 },
  flags: { signal_secret: 3, journal_hidden: 3, vault_flooded: 3 },
  final: ['hold'],
  manages: true,
  extraBuilds: ['guard', 'catcher', 'salvage'],
  decrees: ['curfew'],
};

/** Порядок прежде всего, но доверие и сплочённость не роняет до порогов кризиса: путь к Крепости. */
export const pragmatic: Strategy = {
  id: 'pragmatic',
  name: 'Прагматик',
  weights: {
    stats: { trust: 0.5, solidarity: 0.3, health: 0.7, order: 1.5 },
    res: { pop: 1, food: 0.5, ether: 0.6, mat: 0.5 },
    factions: { stokers: 0.2, institute: 0.2 },
    altitude: 0.5,
  },
  floors: { trust: 40, solidarity: 35, health: 40 },
  prefer: { d02_raft: 1, d05_quarantine: 1 },
  flags: { signal_secret: 3, dropped_lower: -50 },
  final: ['hold'],
  manages: true,
  extraBuilds: ['guard', 'salvage'],
};

/** Ищет правду и путь к запечатыванию разлома: открыть отсек, вернуть Ильина, сохранить доверие. */
export const seeker: Strategy = {
  id: 'seeker',
  name: 'Ищущий правду',
  weights: {
    stats: { trust: 2, solidarity: 1, health: 1, order: 0.5 },
    res: { pop: 1, food: 0.3, ether: 0.3, mat: 0.2 },
    factions: { institute: 0.2, sky: 0.2 },
  },
  prefer: { d04_lab: 2, d06_signal: 1, d14_vault: 0, d15_harbor: 1, d16_price: 0, d17_key_known: 0 },
  flags: {
    lab_reports: 5,
    vershov_found: 10,
    ilyin_redeemed: 10,
    seal_open: 10,
    ia_trust: 5,
    dropped_lower: -50,
  },
  final: ['seal', 'harbor', 'hold'],
  manages: true,
  extraBuilds: ['infirmary', 'catcher'],
};

export const idle: Strategy = {
  id: 'idle',
  name: 'Ничего не строит',
  weights: {},
  final: ['hold'],
  manages: false,
  random: true,
};

/** Случайные варианты, но башню ведёт: показывает, что выпадает у «среднего» игрока. */
export const randomPlayer: Strategy = {
  id: 'random',
  name: 'Случайный',
  weights: {},
  final: ['harbor', 'seal', 'hold'],
  manages: true,
  random: true,
};

export const STRATEGIES: Strategy[] = [merciful, harsh, pragmatic, seeker, idle, randomPlayer];
