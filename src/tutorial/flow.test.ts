import { describe, expect, it } from 'vitest';
import { gameData } from '../core';
import { ANCHOR_SELECTORS, anchorSelectors } from './anchors';
import { debugDay, flowSteps, hasOk, stepCard, stepCount, viewKey, WELCOME_ID } from './flow';
import { tutorialFile } from './model';
import { ANCHORS } from './schema';

const steps = tutorialFile.steps;
const step = (id: string) => {
  const s = steps.find((x) => x.id === id);
  if (!s) throw new Error(`нет шага ${id}`);
  return s;
};

describe('якоря обучения', () => {
  it('у каждого имени из ANCHORS есть селектор, кроме center', () => {
    for (const a of ANCHORS) {
      expect(ANCHOR_SELECTORS[a], a).toBeDefined();
      if (a !== 'center') expect(ANCHOR_SELECTORS[a].length, a).toBeGreaterThan(0);
    }
    expect(anchorSelectors('center')).toEqual([]);
  });

  it('каждый вид шага указывает на известный якорь', () => {
    for (const s of steps)
      for (const v of s.views) expect(ANCHOR_SELECTORS[v.target], `${s.id} → ${v.target}`).toBeDefined();
  });

  it('ярус во Мгле подставляется, без яруса селектора нет', () => {
    expect(anchorSelectors('tier_in_mist', { mistTier: 1 })).toEqual(['.tw-hit[data-tier="1"]']);
    expect(anchorSelectors('tier_in_mist')).toEqual([]);
    expect(anchorSelectors('нет_такого')).toEqual([]);
  });
});

describe('карточка шага', () => {
  it('приветствие не идёт через наблюдатель и не считается в «N из M»', () => {
    expect(flowSteps(steps).some((s) => s.id === WELCOME_ID)).toBe(false);
    expect(stepCount(steps, WELCOME_ID)).toBeUndefined();
    const first = flowSteps(steps).filter((s) => s.chain === 'first');
    expect(stepCount(steps, first[0]?.id ?? '')).toBe(`1 из ${first.length}`);
    expect(stepCount(steps, 'alarm')).toBeUndefined();
  });

  it('«Понятно» у чтения и у необязательного действия, у вкладки и конца дня — нет', () => {
    expect(hasOk(step('build'))).toBe(true);
    expect(hasOk(step('engine'))).toBe(true);
    expect(hasOk(step('end_day'))).toBe(false);
    expect(hasOk(step('event_arrows'))).toBe(true);
    expect(hasOk(step('hud_resources'))).toBe(true);
  });

  it('числа в тексте берутся из баланса', () => {
    const s = step('engine');
    const view = s.views[0];
    if (!view) throw new Error('нет вида');
    const card = stepCard(tutorialFile, gameData.balance, s, view);
    expect(card.text).not.toMatch(/[{}]/);
    expect(card.text).toContain(String(gameData.balance.engine.modes.climb.altitude));
    expect(card.voice).toBe(tutorialFile.speaker.name);
    expect(card.ok).toBe(tutorialFile.labels.ok);
    expect(viewKey(s, view)).toBe('engine#0');
  });

  it('день отладки — из when.minDay', () => {
    expect(debugDay(step('build'))).toBe(1);
    const late = steps.find((s) => (s.when?.minDay ?? 0) > 1);
    if (late) expect(debugDay(late)).toBe(late.when?.minDay);
  });
});
