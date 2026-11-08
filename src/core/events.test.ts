import { describe, expect, it } from 'vitest';
import { applyChoice, choiceAvailability, DROPPED_TIER_SCAR, previewChoice } from './choice';
import { gameData } from './data';
import { characterFates, resolveEnding } from './endings';
import { buildMorningQueue, eventText, findEvent } from './events';
import { createInitialState } from './state';
import type { GameState } from './types';

const fresh = (seed: number | string = 'events') => createInitialState(gameData.balance, seed);
const atDay = (day: number, patch: Partial<GameState> = {}): GameState => ({ ...fresh(), day, ...patch });

describe('очередь утра', () => {
  it('день 1: только сюжетное событие, пул не тянется и генератор не сдвигается', () => {
    expect(gameData.balance.events.firstDayWindows).toBe(1);
    for (const seed of ['events', 1, 2, 3, 'tutorial']) {
      const { queue, state } = buildMorningQueue(fresh(seed), gameData);
      expect(queue).toEqual(['d01_first_morning']);
      expect(state.rng).toEqual(fresh(seed).rng);
    }
  });

  it('дни 2 и 3: сюжетное событие и одно из пула, как раньше', () => {
    for (const [day, story] of [
      [2, 'd02_raft'],
      [3, 'd03_shifts'],
    ] as const) {
      const { queue, state } = buildMorningQueue(atDay(day), gameData);
      expect(queue[0]).toBe(story);
      expect(queue).toHaveLength(gameData.balance.events.maxWindowsPerMorning);
      expect(findEvent(gameData, queue[1] ?? '').pool).toBe('common');
      expect(state.rng).not.toEqual(atDay(day).rng);
    }
  });

  it('отложенное событие на сегодня встаёт после сюжетного и снимается из scheduled', () => {
    const s = atDay(10, {
      flags: ['lied_day1'],
      scheduled: [
        { day: 10, event: 'late_ledger' },
        { day: 12, event: 'late_stowaway' },
      ],
    });
    const { queue, state } = buildMorningQueue(s, gameData);
    expect(queue).toEqual(['d10_journal_ilyin', 'late_ledger']);
    expect(state.scheduled).toEqual([{ day: 12, event: 'late_stowaway' }]);
  });

  it('отложенное с невыполненным requires отменяется', () => {
    const s = atDay(10, { scheduled: [{ day: 10, event: 'late_ledger' }] });
    const { queue, state } = buildMorningQueue(s, gameData);
    expect(queue).not.toContain('late_ledger');
    expect(state.scheduled).toEqual([]);
  });

  it('лишние окна переносятся на завтра, сюжетное остаётся', () => {
    const s = atDay(10, {
      flags: ['lied_day1', 'ia_stowaway'],
      scheduled: [
        { day: 10, event: 'late_ledger' },
        { day: 10, event: 'late_stowaway' },
      ],
    });
    const { queue, state } = buildMorningQueue(s, gameData);
    expect(queue).toEqual(['d10_journal_ilyin', 'late_ledger']);
    expect(state.scheduled).toEqual([{ day: 11, event: 'late_stowaway' }]);
    const tomorrow = buildMorningQueue({ ...state, day: 11 }, gameData);
    expect(tomorrow.queue).toEqual(['d11_dim', 'late_stowaway']);
  });

  it('кризис при доверии ниже порога', () => {
    const s = atDay(3, {
      stats: { ...fresh().stats, trust: (gameData.balance.thresholds.trustRumors ?? 0) - 1 },
    });
    expect(buildMorningQueue(s, gameData).queue).toEqual(['d03_shifts', 'crisis_rumors']);
    const calm = atDay(3);
    expect(buildMorningQueue(calm, gameData).queue).not.toContain('crisis_rumors');
  });

  it('пул детерминирован при одном сиде и не повторяет недавние', () => {
    for (const seed of ['a', 'b', 'c', 7, 42]) {
      const a = buildMorningQueue(atDay(4), gameData);
      const b = buildMorningQueue(atDay(4), gameData);
      expect(a).toEqual(b);
      const s = atDay(4, { rng: fresh(seed).rng });
      expect(buildMorningQueue(s, gameData)).toEqual(buildMorningQueue(s, gameData));
    }
    const first = buildMorningQueue(atDay(4), gameData).queue[1] ?? '';
    const seen = buildMorningQueue(atDay(4, { seen: { [first]: 3 } }), gameData).queue;
    expect(seen).not.toContain(first);
  });
});

describe('текст события', () => {
  it('добавляет абзацы extraText по условиям', () => {
    const final = findEvent(gameData, 'd20_final');
    const high = eventText(atDay(20, { stats: { ...fresh().stats, solidarity: 70 } }), final);
    expect(high.split('\n\n')).toHaveLength(2);
    expect(high).toContain('демонстрацию');
    expect(eventText(atDay(20), findEvent(gameData, 'd01_first_morning'))).not.toContain('\n');
  });
});

describe('выбор', () => {
  it('d01: ложь ставит флаг, откладывает late_ledger на 9 дней и пишет в стенгазету', () => {
    const before = fresh();
    const { state, result } = applyChoice(before, gameData, 'd01_first_morning', 1);
    expect(state.flags).toContain('lied_day1');
    expect(state.scheduled).toEqual([{ day: 10, event: 'late_ledger' }]);
    expect(state.log).toEqual([{ day: 1, text: 'Председатель заверил: запасов хватит надолго.' }]);
    expect(state.seen.d01_first_morning).toBe(1);
    expect(state.stats.order).toBe(before.stats.order + 8);
    expect(result.deltas.stats).toEqual({ order: 8 });
    expect(result.remembered).toEqual({ flags: ['lied_day1'], delayed: [{ day: 10, event: 'late_ledger' }] });
    expect(before.flags).toEqual([]);
  });

  it('показатели ограничены 0–100, ресурсы не уходят ниже нуля', () => {
    const s = fresh();
    s.stats.trust = 98;
    const { state, result } = applyChoice(s, gameData, 'd01_first_morning', 0);
    expect(state.stats.trust).toBe(100);
    expect(result.deltas.stats.trust).toBe(2);
  });

  it('вариант закрыт, если не хватает cost', () => {
    const s = atDay(4);
    s.res.mat = 5;
    const choice = findEvent(gameData, 'd04_lab').choices[0];
    if (!choice) throw new Error('нет варианта');
    expect(choiceAvailability(s, choice)).toMatchObject({
      available: false,
      visible: true,
      status: 'cost',
      reason: 'Нужно 15 материалов',
      missing: { mat: 10 },
    });
    expect(() => applyChoice(s, gameData, 'd04_lab', 0)).toThrow();
    s.res.mat = 15;
    expect(applyChoice(s, gameData, 'd04_lab', 0).state.res.mat).toBe(0);
  });

  it('requires с lockedText виден закрытым', () => {
    const choice = findEvent(gameData, 'd20_final').choices[1];
    if (!choice) throw new Error('нет варианта');
    expect(choiceAvailability(atDay(20), choice)).toMatchObject({ visible: true, status: 'locked' });
    expect(choiceAvailability(atDay(20, { flags: ['seal_open'] }), choice).available).toBe(true);
  });

  it('dropTier lower сбрасывает нижний ярус с жителями', () => {
    const s = atDay(16);
    const { state, result } = applyChoice(s, gameData, 'd16_price', 2);
    // 20 жителей: 4 в Корне, 12 в ярусе с двумя жилыми модулями, 4 в Шпиле.
    expect(result.tower?.dropped).toEqual({ index: 1, kind: 'tier', killed: 12 });
    expect(state.tiers.map((t) => t.kind)).toEqual(['root', 'spire']);
    expect(state.res.pop).toBe(8);
    expect(state.stats.solidarity).toBe(
      60 - 30 + gameData.balance.tower.dropTier.solidarityPerTierWithPeople,
    );
    expect(state.scars).toContain(DROPPED_TIER_SCAR);
    expect(state.flags).toContain('dropped_lower');
  });

  it('dropTier empty выбирает ярус с наименьшим числом жителей', () => {
    const s = atDay(16);
    s.tiers.splice(2, 0, { kind: 'tier', slots: ['farm', null, null], mistNights: 0, abandoned: false });
    const { state, result } = applyChoice(s, gameData, 'd16_price', 1);
    expect(result.tower?.dropped).toEqual({ index: 2, kind: 'tier', killed: 0 });
    expect(state.tiers).toHaveLength(3);
    expect(state.res.pop).toBe(20);
    expect(state.stats.solidarity).toBe(60);
  });

  it('модификатор получает left = nights и сохраняет отсрочку', () => {
    const s = atDay(14);
    const once = applyChoice(s, gameData, 'd14_vault', 2);
    expect(once.result.modifiers).toHaveLength(1);
    expect(once.state.modifiers).toEqual([
      expect.objectContaining({ id: 'engine_glitch', nights: 6, left: 6, startInNights: 2 }),
    ]);
    // Повторный модификатор с тем же id заменяет прежний, а не копится.
    const twice = applyChoice({ ...once.state, seen: {} }, gameData, 'd14_vault', 2);
    expect(twice.state.modifiers).toHaveLength(1);
  });

  it('подсказка: стрелки по шагам и «это запомнят»', () => {
    const p = previewChoice(fresh(), gameData, 'd01_first_morning', 0);
    expect(p.stats).toEqual([
      { key: 'trust', dir: 'up', level: 2, arrows: '↑↑' },
      { key: 'order', dir: 'down', level: 2, arrows: '↓↓' },
    ]);
    expect(p.remembered).toBe(true);
    const silent = previewChoice(fresh(), gameData, 'd01_first_morning', 2);
    expect(silent.remembered).toBe(false);
    const raft = previewChoice(atDay(16), gameData, 'd16_price', 2);
    expect(raft.factions).toEqual([{ key: 'mistborn', sign: '-' }]);
  });
});

describe('концовки', () => {
  const finalState = (patch: Partial<GameState>, stats: Partial<GameState['stats']> = {}) =>
    atDay(20, { ...patch, stats: { ...fresh().stats, ...stats } });

  it('путь Гавани по солидарности и dropped_lower', () => {
    expect(resolveEnding(finalState({ ending: 'harbor' }), gameData)?.id).toBe('harbor');
    const refused = resolveEnding(
      finalState({ ending: 'harbor', flags: ['dropped_lower'] }, { order: 70 }),
      gameData,
    );
    expect(refused?.id).toBe('fortress');
    expect(refused?.harborRefused).toBe(gameData.endings.harborRefused);
    expect(resolveEnding(finalState({ ending: 'harbor' }, { solidarity: 40, order: 50 }), gameData)?.id).toBe(
      'fall',
    );
  });

  it('раскол перекрывает путь, жертва зависит от доверия', () => {
    expect(resolveEnding(finalState({ ending: 'hold' }, { solidarity: 20 }), gameData)?.id).toBe('schism');
    const seal = resolveEnding(finalState({ ending: 'seal', flags: ['conductor_marta'] }), gameData);
    expect(seal?.id).toBe('seal');
    expect(seal?.text).toContain('Марта не вернулась');
    expect(resolveEnding(finalState({ ending: 'seal' }, { trust: 30 }), gameData)?.id).toBe('overthrow');
    expect(resolveEnding(finalState({}), gameData)).toBeNull();
  });

  it('судьбы: первая со всеми флагами, иначе default', () => {
    const fates = characterFates(
      finalState({ flags: ['marta_saved', 'marta_broken', 'wind_banned'] }),
      gameData,
    );
    const by = Object.fromEntries(fates.map((f) => [f.who, f.text]));
    expect(by.marta).toContain('Учит детей');
    expect(by.wind).toContain('Ушёл в туман');
    expect(by.lev).toBe('Каждую ночь слушает эфир.');
    // Без строки default (Звёздочка) судьба показывается, только если флаг стоит
    const always = Object.values(gameData.endings.fates).filter((list) => list.some((f) => f.default));
    expect(fates).toHaveLength(always.length);
  });
});

describe('прогон 20 дней первым доступным вариантом', () => {
  for (const seed of ['run-1', 'run-2', 12345]) {
    it(`сид ${seed}`, () => {
      let s = fresh(seed);
      const shown: string[] = [];
      for (let day = 1; day <= gameData.balance.calendar.days; day++) {
        s = { ...s, day };
        const morning = buildMorningQueue(s, gameData);
        s = morning.state;
        expect(morning.queue[0]).toMatch(/^d\d\d_/);
        for (const id of morning.queue) {
          const event = findEvent(gameData, id);
          const index = event.choices.findIndex((c) => choiceAvailability(s, c).available);
          expect(index, `${id}: нет доступного варианта`).toBeGreaterThanOrEqual(0);
          previewChoice(s, gameData, id, index);
          s = applyChoice(s, gameData, id, index).state;
          shown.push(id);
        }
      }
      expect(shown).toContain('d20_final');
      expect(resolveEnding(s, gameData)).not.toBeNull();
      expect(characterFates(s, gameData).length).toBeGreaterThan(0);
    });
  }
});
