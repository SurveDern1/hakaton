import { describe, expect, it } from 'vitest';
import type { GameState } from '../core';
import { applyChoice, build, createInitialState, gameData, runNight, setEngineMode } from '../core';
import { PORTRAITS } from '../ui/portraits';
import { hasOk } from './flow';
import {
  buildContext,
  currentStep,
  firstChainIds,
  isDone,
  markDone,
  resetProgress,
  setTutorialOn,
  type TutorialContext,
  type TutorialGamePhase,
  type TutorialProgress,
  type TutorialUi,
  tutorialFile,
  tutorialSignals,
} from './model';
import { checkTutorial, fillText } from './schema';
import { migrateProgress, parseProgress } from './storage';

const data = gameData;
const b = data.balance;
const steps = tutorialFile.steps;
const step = (id: string) => {
  const s = steps.find((x) => x.id === id);
  if (!s) throw new Error(id);
  return s;
};
const ctx = (
  state: GameState,
  phase: TutorialGamePhase,
  ui: Partial<TutorialUi> = {},
  phaseTip: string | null = null,
): TutorialContext => buildContext(state, data, phase, ui, phaseTip);
const shown = (p: TutorialProgress, c: TutorialContext) => currentStep(steps, p, c);

/** Показать шаг, сделать действие и убедиться, что этот шаг им закрылся. */
function expectStep(p: TutorialProgress, before: TutorialContext, id: string, target: string) {
  const now = shown(p, before);
  expect(now?.step.id).toBe(id);
  expect(now?.view.target).toBe(target);
  return now?.step;
}

describe('data/tutorial.json', () => {
  it('сходится с проверкой и балансом', () => {
    expect(checkTutorial(tutorialFile, b)).toEqual([]);
  });

  it('голос — знак из portraits.ts', () => {
    expect(PORTRAITS[tutorialFile.speaker.portrait]).toBeDefined();
  });

  it('подстановки из баланса раскрываются во всех текстах', () => {
    for (const s of steps)
      for (const v of s.views) expect(fillText(`${v.title ?? ''} ${v.text}`, b)).not.toMatch(/[{}]/);
    expect(fillText('ещё {tower.mistNightsToAbandon} ночи', b)).toBe(
      `ещё ${b.tower.mistNightsToAbandon} ночи`,
    );
    expect(fillText('{tower.mistTierBuildingFactor}', b)).toBe(
      String(b.tower.mistTierBuildingFactor).replace('.', ','),
    );
    expect(fillText('{нет.такого}', b)).toBe('{нет.такого}');
  });

  it('checkTutorial находит ошибки', () => {
    const view = { target: 'end_day', text: 'ок' };
    const bad = {
      ...tutorialFile,
      steps: [
        { id: 'a', chain: 'first', phase: 'day', views: [view], done: 'ok' },
        { id: 'a', chain: 'first', phase: 'day', views: [view], done: 'ok' },
        { id: 'b', chain: 'tip', phase: 'day', signal: 'rain', views: [view], done: 'jump' },
        {
          id: 'c',
          chain: 'first',
          phase: 'day',
          views: [{ target: 'nowhere', ui: 'x', text: ' ' }],
          done: 'ok',
        },
        {
          id: 'd',
          chain: 'first',
          phase: 'day',
          views: [{ target: 'end_day', text: '{tower.nope}' }],
          done: 'ok',
        },
        { id: 'e', chain: 'first', phase: 'morning', views: [view], done: 'ok' },
        { id: 'f', chain: 'first', phase: 'day', when: { minDays: 2 }, views: [], done: 'ok' },
      ],
    };
    const errors = checkTutorial(bad, b).join('\n');
    expect(errors).toContain('повтор id a');
    expect(errors).toContain('неизвестный сигнал rain');
    expect(errors).toContain('неизвестный done jump');
    expect(errors).toContain('неизвестный якорь nowhere');
    expect(errors).toContain('неизвестный ui x');
    expect(errors).toContain('пустой text');
    expect(errors).toContain('{tower.nope} нет числа');
    expect(errors).toContain('утром цель только в окне события');
    expect(errors).toContain('when.minDays');
    expect(errors).toContain('f: нет views');
  });
});

describe('сценарий первых дней', () => {
  it('дни 1–3 идут по порядку, каждый шаг закрывается своим действием', () => {
    let p = resetProgress();
    let s = createInitialState(b, 'tutorial');
    const ok = (id: string) => {
      p = markDone(p, id);
    };
    const act = (id: string, prev: TutorialContext, next: TutorialContext) => {
      expect(isDone(step(id), prev, next)).toBe(true);
      p = markDone(p, id);
    };

    // Утро 1: приветствие до окна, затем стрелки и ⧗ одной карточкой в окне события.
    expectStep(p, ctx(s, 'morning'), 'welcome', 'center');
    ok('welcome');
    expect(shown(p, ctx(s, 'morning'))).toBeNull();
    const ev = ctx(s, 'morning', { eventOpen: true, memoryHint: true });
    expectStep(p, ev, 'event_arrows', 'event_arrows');
    s = applyChoice(s, data, 'd01_first_morning', 0).state;
    act('event_arrows', ev, ctx(s, 'morning', { eventOpen: true, memoryHint: true }));
    expect(shown(p, ctx(s, 'morning', { eventOpen: true, memoryHint: true }))).toBeNull();

    // День 1, телефон.
    const phone = { layout: 'phone' as const };
    const closed = ctx(s, 'day', phone);
    expectStep(p, closed, 'build', 'slot_root_empty');
    expect(isDone(step('build'), closed, ctx(s, 'day', { ...phone, menuOpen: true }))).toBe(false);
    const open = ctx(s, 'day', { ...phone, menuOpen: true });
    expectStep(p, open, 'build', 'build_menu');
    const built = build(s, data, 0, 2, 'farm');
    if (!built.ok) throw new Error(built.reason);
    s = built.state;
    act('build', open, ctx(s, 'day', phone));

    // Двигатель на телефоне: сперва «откройте вкладку Ночь», на ней — режимы.
    const statsTab = ctx(s, 'day', { ...phone, tab: 'stats' });
    expectStep(p, statsTab, 'engine', 'tab_night');
    const nightTab = ctx(s, 'day', { ...phone, tab: 'night' });
    expectStep(p, nightTab, 'engine', 'engine_modes');
    s = setEngineMode(s, 'climb');
    act('engine', nightTab, ctx(s, 'day', { ...phone, tab: 'night' }));
    const evening = ctx(s, 'day', { ...phone, tab: 'night' });
    expectStep(p, evening, 'end_day', 'end_day');
    act('end_day', evening, ctx(s, 'night', phone));
    expect(shown(p, ctx(s, 'night', phone))).toBeNull();

    // Утро 2: отчёт о ночи; день 2: запасы, Мгла и новый ярус.
    s = runNight(s, data).state;
    expect(s.day).toBe(2);
    expect(shown(p, ctx(s, 'morning', { eventOpen: true }))).toBeNull();
    const report = ctx(s, 'morning', { eventOpen: true, reportShown: true });
    expectStep(p, report, 'night_report', 'event_report');
    ok('night_report');
    expectStep(p, ctx(s, 'day', phone), 'hud_resources', 'hud_resources');
    ok('hud_resources');
    expectStep(p, ctx(s, 'day', phone), 'mist', 'hud_mist');
    ok('mist');
    expectStep(p, ctx(s, 'day', phone), 'new_tier', 'tab_night');
    expectStep(p, ctx(s, 'day', { ...phone, tab: 'night' }), 'new_tier', 'new_tier');
    ok('new_tier');

    // День 3: шкалы, фракции, декреты — на широкой раскладке без вкладок.
    s = runNight(s, data).state;
    const wide = ctx(s, 'day', { layout: 'wide' });
    expectStep(p, wide, 'stats', 'stats');
    ok('stats');
    expectStep(p, wide, 'factions', 'factions');
    ok('factions');
    expectStep(p, wide, 'decrees', 'decrees');
    ok('decrees');
    // Не больше пяти карточек сценария за день, приветствие тоже в счёт.
    const perDay = new Map<number, number>();
    for (const st of steps.filter((x) => x.chain === 'first')) {
      const d = st.when?.minDay ?? 1;
      perDay.set(d, (perDay.get(d) ?? 0) + 1);
    }
    for (const n of perDay.values()) expect(n).toBeLessThanOrEqual(5);
    expect(firstChainIds(steps).every((id) => p.done.includes(id))).toBe(true);
  });

  it('пропущенный шаг дня не всплывает в другой день', () => {
    const s = { ...createInitialState(b, 'skip'), day: 2 };
    const p = { ...resetProgress(), done: ['welcome', 'event_arrows', 'night_report'] };
    expect(shown(p, ctx(s, 'day'))?.step.id).toBe('hud_resources');
  });

  it('продолжение посреди дня 1 показывает незаконченный шаг', () => {
    const s = createInitialState(b, 'resume');
    const p = { ...resetProgress(), done: ['welcome', 'event_arrows', 'hud_resources'] };
    const raw = JSON.stringify(p);
    expect(shown(parseProgress(raw), ctx(s, 'day'))?.step.id).toBe('build');
  });

  it('на широкой раскладке вкладок нет: двигатель сразу у режимов', () => {
    const s = createInitialState(b, 'wide');
    const p = { ...resetProgress(), done: ['welcome', 'event_arrows', 'hud_resources', 'build'] };
    expect(shown(p, ctx(s, 'day', { layout: 'wide' }))?.view.target).toBe('engine_modes');
  });

  it('вкладка открыта не по порядку — шаг про неё, а не «откройте другую»', () => {
    const s = { ...createInitialState(b, 'tabs'), day: 3 };
    const p = { ...resetProgress(), done: ['welcome', 'event_arrows', 'night_report'] };
    const phone = { layout: 'phone' as const };
    expectStep(p, ctx(s, 'day', phone), 'stats', 'tab_stats');
    expectStep(p, ctx(s, 'day', { ...phone, tab: 'decrees' }), 'decrees', 'decrees');
    expectStep(p, ctx(s, 'day', { ...phone, tab: 'stats' }), 'stats', 'stats');
  });

  it('без стройки и смены режима день 1 не застревает: у шагов есть «Понятно»', () => {
    const s = createInitialState(b, 'lazy');
    let p = { ...resetProgress(), done: ['welcome', 'event_arrows', 'hud_resources'] };
    const day = ctx(s, 'day', { layout: 'wide' });
    for (const id of ['build', 'engine']) {
      expect(shown(p, day)?.step.id).toBe(id);
      expect(hasOk(step(id))).toBe(true);
      p = markDone(p, id);
    }
    expect(shown(p, day)?.step.id).toBe('end_day');
  });

  it('выключено — ни одного шага', () => {
    const s = createInitialState(b, 'off');
    const off = setTutorialOn(resetProgress(), false);
    for (const phase of ['morning', 'day'] as const) {
      expect(shown(off, ctx(s, phase, { eventOpen: true, memoryHint: true, lockedChoice: true }))).toBeNull();
    }
    expect(shown(resetProgress(), ctx(s, 'night'))).toBeNull();
  });
});

describe('подсказки по случаю', () => {
  const afterFirst = (): TutorialProgress => ({ ...resetProgress(), done: firstChainIds(steps) });
  const crowded = (): GameState => {
    const s = createInitialState(b, 'tips');
    return { ...s, day: 4, res: { ...s.res, pop: s.res.pop + 10 } };
  };

  it('сигналы считаются по состоянию и прогнозу', () => {
    const s = createInitialState(b, 'signals');
    expect(tutorialSignals(s, data, 'day', ctx(s, 'day').ui)).toEqual([]);
    expect(ctx(crowded(), 'day').signals).toContain('homeless');
    expect(ctx({ ...s, res: { ...s.res, ether: 0 } }, 'day').signals).toContain('alarm');
    expect(ctx({ ...s, res: { ...s.res, ether: 0 } }, 'morning').signals).not.toContain('alarm');
    expect(
      ctx({ ...s, stats: { ...s.stats, health: b.thresholds.healthDeaths ?? 0 } }, 'day').signals,
    ).toContain('statLow');
    expect(ctx({ ...s, mist: s.altitude + b.tower.tierHeight }, 'day').signals).toContain('tierInMist');
    expect(ctx({ ...s, day: 4 }, 'day').signals).not.toContain('newDecrees');
    expect(ctx({ ...s, day: 5 }, 'day').signals).toContain('newDecrees');
    expect(ctx(s, 'morning', { lockedChoice: true }).signals).toContain('lockedChoice');
  });

  it('показывается один раз за всё время и не больше одной за фазу', () => {
    const s = crowded();
    let p = afterFirst();
    const first = shown(p, ctx(s, 'day'));
    expect(first?.step.id).toBe('homeless');
    // Пока не закрыта — показывается она же, даже если сработал другой случай.
    const both = { ...s, res: { ...s.res, ether: 0 } };
    expect(shown(p, ctx(both, 'day', {}, 'homeless'))?.step.id).toBe('homeless');
    p = markDone(p, 'homeless');
    // В эту фазу больше ничего, хотя кнопка дня красная.
    expect(shown(p, ctx(both, 'day', {}, 'homeless'))).toBeNull();
    // Следующая фаза — следующий случай, а сама подсказка о жилье больше не появится.
    expect(shown(p, ctx(both, 'day'))?.step.id).toBe('alarm');
    expect(shown(p, ctx(s, 'day'))?.step.id).toBe('paper');
    p = markDone(p, 'paper');
    expect(shown(p, ctx(s, 'day'))).toBeNull();
  });

  it('утром — только с целью в окне события', () => {
    const s = crowded();
    const p = afterFirst();
    expect(shown(p, ctx(s, 'morning', { eventOpen: true }))).toBeNull();
    expect(shown(p, ctx(s, 'morning', { eventOpen: true, lockedChoice: true }))?.view.target).toBe(
      'event_locked',
    );
  });

  it('шаг-действие закрывается только своим действием', () => {
    const s = createInitialState(b, 'done');
    const day = ctx(s, 'day');
    expect(isDone(step('hud_resources'), day, ctx(s, 'night'))).toBe(false);
    expect(isDone(step('end_day'), day, ctx(s, 'day', { menuOpen: true }))).toBe(false);
    expect(isDone(step('engine'), day, ctx(setEngineMode(s, 'hold'), 'day'))).toBe(false);
  });
});

describe('прогресс в localStorage', () => {
  it('битая или чужая запись — по умолчанию', () => {
    for (const raw of [null, '', '{', '[]', '{"v":2,"on":false,"done":[]}', '{"v":1,"on":"yes","done":[]}']) {
      expect(parseProgress(raw)).toEqual(resetProgress());
    }
    expect(parseProgress('{"v":1,"on":false,"done":["a","a",3]}')).toEqual({ v: 1, on: false, done: ['a'] });
  });

  it('уже играл (Р2): сценарий первых дней пройден, подсказки по случаю остаются', () => {
    const p = migrateProgress(null, true, steps);
    expect(p.on).toBe(true);
    expect(p.done).toEqual(firstChainIds(steps));
    expect(shown(p, ctx(createInitialState(b, 'old'), 'morning'))).toBeNull();
    expect(migrateProgress(null, false, steps)).toEqual(resetProgress());
    expect(migrateProgress('{"v":1,"on":false,"done":[]}', true, steps).on).toBe(false);
  });
});
