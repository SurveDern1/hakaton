import { describe, expect, it } from 'vitest';
import { gameData } from '../core';
import { WELCOME_ID } from './flow';
import { buildMemo, MEMO_SECTION_OF, MEMO_SECTIONS, memoEntry, memoSection } from './memo';
import { tutorialFile } from './model';
import { ANCHORS, fillText, type TutorialFile, type TutorialStep } from './schema';

const balance = gameData.balance;
const allIds = tutorialFile.steps.map((s) => s.id);

const step = (id: string, views: TutorialStep['views'], extra: Partial<TutorialStep> = {}): TutorialStep => ({
  id,
  chain: 'first',
  phase: 'day',
  views,
  done: 'ok',
  ...extra,
});

const file: TutorialFile = {
  ...tutorialFile,
  steps: [
    step(WELCOME_ID, [{ target: 'center', title: 'Привет', text: 'Покажу главное' }]),
    step('engine', [
      {
        layout: 'wide',
        target: 'engine_modes',
        title: 'Двигатель',
        text: 'Подъём +{engine.modes.climb.altitude} м',
      },
      {
        ui: 'tab:night',
        target: 'engine_modes',
        title: 'Двигатель',
        text: 'Подъём +{engine.modes.climb.altitude} м',
      },
      { target: 'tab_night', title: 'Двигатель', text: 'Откройте вкладку «Ночь»' },
    ]),
    step('night_tab', [{ layout: 'phone', target: 'tab_night', title: 'Прогноз', text: 'Откройте «Ночь»' }]),
    step('build', [
      { ui: 'menuOpen', target: 'build_menu', title: 'Что строить', text: 'Ферма кормит' },
      { ui: 'menuClosed', target: 'slot_root_empty', title: 'Стройка', text: 'Нажмите на пустое место' },
    ]),
    step('arrows', [{ target: 'event_arrows', text: 'Стрелки' }]),
    step('lost', [{ target: 'center', title: 'Без цели', text: 'Текст' }], { chain: 'tip' }),
  ],
};

describe('памятка', () => {
  it('у каждого якоря есть раздел (или null у center), разделы из MEMO_SECTIONS', () => {
    const ids = MEMO_SECTIONS.map((s) => s.id) as string[];
    for (const a of ANCHORS) {
      expect(a in MEMO_SECTION_OF, a).toBe(true);
      const s = MEMO_SECTION_OF[a];
      if (a === 'center') expect(s).toBeNull();
      else expect(ids, a).toContain(s);
    }
  });

  it('пусто, пока ничего не пройдено; приветствие в памятку не попадает', () => {
    expect(buildMemo(file, balance, [], 'phone')).toEqual({ sections: [], done: 0, total: 5 });
    expect(buildMemo(file, balance, [WELCOME_ID], 'phone').sections).toEqual([]);
  });

  it('только пройденные, по разделам в порядке MEMO_SECTIONS', () => {
    const memo = buildMemo(file, balance, ['lost', 'engine', 'arrows', 'build'], 'phone');
    expect(memo.done).toBe(4);
    expect(memo.sections.map((s) => s.id)).toEqual(['event', 'build', 'night', 'other']);
    expect(memo.sections[0]?.entries.map((e) => e.id)).toEqual(['arrows']);
    // Без заголовка у вида — заголовок раздела
    expect(memo.sections[0]?.entries[0]?.title).toBe('Окно события');
    expect(memo.sections[3]?.entries[0]?.title).toBe('Без цели');
  });

  it('раздел — по первому виду с разделом; без него «Прочее»', () => {
    const [, engine, , build, , lost] = file.steps;
    if (!engine || !build || !lost) throw new Error('нет шага');
    expect(memoSection(engine)).toBe('night');
    expect(memoSection(build)).toBe('build');
    expect(memoSection(lost)).toBe('other');
  });

  it('суть без повторов и без указателя на вкладку; числа из баланса', () => {
    const engine = file.steps[1];
    if (!engine) throw new Error('нет шага');
    const want = [`Подъём +${balance.engine.modes.climb.altitude} м`];
    expect(memoEntry(engine, balance, 'phone').texts).toEqual(want);
    expect(memoEntry(engine, balance, 'wide').texts).toEqual(want);
  });

  it('шаг только с указателем на вкладку и только для другой раскладки всё равно виден', () => {
    const tab = file.steps[2];
    if (!tab) throw new Error('нет шага');
    expect(memoEntry(tab, balance, 'wide')).toEqual({
      id: 'night_tab',
      title: 'Прогноз',
      texts: ['Откройте «Ночь»'],
    });
  });

  it('два разных вида — оба текста', () => {
    const build = file.steps[3];
    if (!build) throw new Error('нет шага');
    expect(memoEntry(build, balance, 'phone')).toEqual({
      id: 'build',
      title: 'Что строить',
      texts: ['Ферма кормит', 'Нажмите на пустое место'],
    });
  });

  it('на настоящем data/tutorial.json: всё пройдено — каждый шаг, кроме приветствия, ровно один раз', () => {
    for (const layout of ['phone', 'wide'] as const) {
      const memo = buildMemo(tutorialFile, balance, allIds, layout);
      const ids = memo.sections.flatMap((s) => s.entries.map((e) => e.id));
      expect(ids.sort()).toEqual(allIds.filter((id) => id !== WELCOME_ID).sort());
      expect(memo.done).toBe(memo.total);
      for (const e of memo.sections.flatMap((s) => s.entries)) {
        expect(e.title, e.id).not.toBe('');
        expect(e.texts.length, e.id).toBeGreaterThan(0);
        for (const t of e.texts) expect(t, e.id).toBe(fillText(t, balance));
        for (const t of e.texts) expect(t, e.id).not.toMatch(/\{[^{}]*\}/);
      }
    }
  });
});
