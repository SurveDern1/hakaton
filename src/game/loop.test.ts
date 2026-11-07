import { describe, expect, it } from 'vitest';
import {
  applyChoice,
  build,
  choiceAvailability,
  createInitialState,
  findEvent,
  forecastNight,
  freeWorkers,
  gameData,
  type NightReport,
} from '../core';
import { GameLoop, type LoopView, type Phase } from './loop';
import { isGameState, parseSave, serializeSave } from './save';
import { GameStore } from './store';

const data = gameData;

/** Экран без DOM: в каждом событии берёт первый доступный вариант (или указанный индекс). */
function headless(store: GameStore, pick: (eventId: string) => number = () => 0) {
  const shown: string[] = [];
  const reports: (NightReport | null)[] = [];
  const view: LoopView = {
    async morning(queue, report) {
      reports.push(report);
      for (const id of queue) {
        shown.push(id);
        const event = findEvent(data, id);
        const wanted = pick(id);
        const order = [wanted, ...event.choices.keys()];
        const i = order.find((k) => {
          const c = event.choices[k];
          return c && choiceAvailability(store.state, c).available;
        });
        if (i === undefined) throw new Error(`Нет доступного варианта в ${id}`);
        store.dispatch((s) => applyChoice(s, data, id, i).state);
      }
    },
    async night(_report, commit) {
      commit();
    },
  };
  return { view, shown, reports };
}

async function playToEnd(loop: GameLoop, maxDays = 30): Promise<void> {
  for (let n = 0; n < maxDays && loop.phase === 'day'; n++) await loop.endDay();
}

describe('цикл дня', () => {
  it('новая игра: утро первого дня с событием, затем день', async () => {
    const store = new GameStore(createInitialState(data.balance, 'loop'));
    const { view, shown, reports } = headless(store);
    const loop = new GameLoop(store, data, view);
    const phases: Phase[] = [];
    loop.onPhase((p) => phases.push(p));
    await loop.newGame('loop');
    expect(phases).toEqual(['start', 'morning', 'day']);
    expect(shown[0]).toBe('d01_first_morning');
    expect(reports).toEqual([null]);
    expect(store.state.day).toBe(1);
  });

  it('ночь меняет день, прогноз совпадает с отчётом', async () => {
    const store = new GameStore(createInitialState(data.balance, 'loop'));
    const { view, reports } = headless(store);
    const loop = new GameLoop(store, data, view);
    await loop.newGame('loop');
    const forecast = forecastNight(store.state, data);
    await loop.endDay();
    expect(store.state.day).toBe(2);
    expect(reports[1]).toEqual(forecast);
    expect(loop.lastReport).toEqual(forecast);
  });

  it('действия только днём, отказ не меняет состояние', async () => {
    const store = new GameStore(createInitialState(data.balance, 'loop'));
    const loop = new GameLoop(store, data, headless(store).view);
    expect(loop.act((s) => build(s, data, 0, 1, 'housing')).ok).toBe(false);
    await loop.newGame('loop');
    const before = store.state;
    const bad = loop.act((s) => build(s, data, 0, 0, 'housing'));
    expect(bad.ok).toBe(false);
    expect(store.state).toBe(before);
    const empty = store.state.tiers[0]?.slots.findIndex((x) => !x) ?? -1;
    const good = loop.act((s) => build(s, data, 0, empty, 'housing'));
    expect(good.ok).toBe(true);
    expect(store.state.res.mat).toBe(before.res.mat - 10);
  });

  it('без стройки башня падает раньше дня 20', async () => {
    const store = new GameStore(createInitialState(data.balance, 'idle'));
    const loop = new GameLoop(store, data, headless(store).view);
    await loop.newGame('idle');
    await playToEnd(loop);
    expect(loop.phase).toBe('final');
    expect(store.state.ending).toBe('fall');
    expect(store.state.day).toBeLessThan(20);
  });

  it('если продержаться, день 20 заканчивается финалом без ночи', async () => {
    const store = new GameStore(createInitialState(data.balance, 'hold'));
    const loop = new GameLoop(store, data, headless(store).view);
    await loop.newGame('hold');
    // Держимся: каждое утро с запасом поднимаем башню над Мглой, без расчёта баланса.
    for (let n = 0; n < 30 && loop.phase === 'day'; n++) {
      store.dispatch((s) => ({
        ...s,
        altitude: s.mist + 40,
        stats: { ...s.stats, trust: 80, solidarity: 80 },
      }));
      await loop.endDay();
    }
    expect(loop.phase).toBe('final');
    expect(store.state.day).toBe(data.balance.calendar.days);
    expect(store.state.ending).not.toBeNull();
  });
});

describe('сохранение', () => {
  it('запись читается обратно', () => {
    const s = createInitialState(data.balance, 'save');
    expect(parseSave(serializeSave(s))).toEqual(s);
  });

  it('битая, чужая и оконченная запись — null', () => {
    const s = createInitialState(data.balance, 'save');
    expect(parseSave(null)).toBeNull();
    expect(parseSave('{не json')).toBeNull();
    expect(parseSave(JSON.stringify({ version: 1, state: { day: 'x' } }))).toBeNull();
    expect(parseSave(JSON.stringify({ version: 99, state: s }))).toBeNull();
    expect(parseSave(serializeSave({ ...s, ending: 'fall' }))).toBeNull();
    expect(isGameState({ ...s, tiers: [] })).toBe(false);
  });
});

describe('свободные руки', () => {
  it('жители минус рабочие зданий', () => {
    const s = createInitialState(data.balance, 'free');
    let busy = 0;
    for (const t of s.tiers) for (const b of t.slots) busy += (b && data.balance.buildings[b]?.workers) || 0;
    expect(freeWorkers(s, data.balance)).toBe(Math.max(0, s.res.pop - busy));
  });
});
