import { describe, expect, it } from 'vitest';
import { labItems } from './lab';
import { limiterReduction, trimForListening } from './metrics';
import { MIX_GROUP_NAMES, MIX_GROUPS, mixGroupOf, SFX_TRIM_DB, WORST_CASE } from './mix';
import { SFX_NAMES } from './sfx';

describe('сведение', () => {
  it('каждый звук группы есть в лаборатории и получает коридор своей группы', () => {
    const items = new Map(labItems().map((i) => [i.id, i]));
    for (const g of MIX_GROUP_NAMES)
      for (const id of MIX_GROUPS[g].ids) {
        expect(items.has(id), id).toBe(true);
        expect(items.get(id)?.limits?.lufs, id).toEqual(MIX_GROUPS[g].lufs);
      }
  });

  it('звук входит не больше чем в одну группу', () => {
    const all = MIX_GROUP_NAMES.flatMap((g) => MIX_GROUPS[g].ids);
    expect(new Set(all).size).toBe(all.length);
    expect(mixGroupOf('sfx:click')).toBe('ui');
    expect(mixGroupOf('sfx:tierDrop')).toBeNull();
  });

  it('уровни плана: интерфейс тише действий, крупные громче, фон под музыкой', () => {
    const mid = (g: keyof typeof MIX_GROUPS) => (MIX_GROUPS[g].lufs[0] + MIX_GROUPS[g].lufs[1]) / 2;
    expect(mid('ui')).toBeLessThan(mid('action'));
    expect(mid('action')).toBeLessThan(mid('large'));
    expect(mid('amb')).toBeLessThan(mid('music'));
  });

  it('поправки — только у существующих звуков', () => {
    for (const name of Object.keys(SFX_TRIM_DB)) expect(SFX_NAMES).toContain(name);
  });

  it('худший случай — в лаборатории, с порогами ослабления и времени рендера', () => {
    const worst = labItems().find((i) => i.id === 'scene:worst');
    expect(worst?.seconds).toBe(WORST_CASE.seconds);
    expect(worst?.limits?.reductionMax).toBe(WORST_CASE.reduction);
    expect(worst?.limits?.renderMsMax).toBe(WORST_CASE.renderMs);
  });
});

describe('ослабление ограничителем', () => {
  const sr = 8000;
  const sine = (n: number, amp: (i: number) => number) =>
    Float32Array.from({ length: n }, (_, i) => amp(i) * Math.sin((2 * Math.PI * 440 * i) / sr));

  it('выход = вход × компенсация — ослабления нет', () => {
    const pre = sine(sr, () => 0.3);
    const post = pre.map((v) => v * 10 ** (3.5 / 20));
    expect(limiterReduction([pre], [post], sr, 3.5, { delayMs: 0 })).toBeCloseTo(0, 1);
  });

  it('провал громкости на выходе меряется от компенсации, с учётом упреждения', () => {
    const n = sr;
    const pre = sine(n, () => 0.5);
    const delay = Math.round(0.006 * sr);
    // ограничитель: +3 дБ компенсации, в середине ещё −8 дБ; выход запаздывает на 6 мс
    const post = new Float32Array(n);
    for (let i = delay; i < n; i++) {
      const j = i - delay;
      const g = 10 ** ((3 - (j > n / 3 && j < (2 * n) / 3 ? 8 : 0)) / 20);
      post[i] = (pre[j] as number) * g;
    }
    expect(limiterReduction([pre], [post], sr, 3)).toBeCloseTo(8, 0);
  });

  it('набор WAV: короткий звук обрезается после затухания, фон — до 10 с, конец без щелчка', () => {
    const n = sr * 9;
    const shot = sine(n, (i) => (i < sr / 2 ? 0.5 : 0));
    const [cut] = trimForListening([shot], sr, 'oneshot');
    expect(cut?.length).toBeGreaterThan(sr / 2);
    expect(cut?.length).toBeLessThan(sr);
    const loop = sine(sr * 16, () => 0.5);
    const [l] = trimForListening([loop], sr, 'loop');
    expect(l?.length).toBe(sr * 10);
    expect(Math.abs(l?.at(-1) ?? 1)).toBeLessThan(1e-3);
  });

  it('тишина и начало рендера не считаются', () => {
    const pre = sine(sr, (i) => (i < sr / 10 ? 0.5 : 0));
    const post = new Float32Array(sr);
    expect(limiterReduction([pre], [post], sr, 3, { skipMs: 150 })).toBe(0);
  });
});
