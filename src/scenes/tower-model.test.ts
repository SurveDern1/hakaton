import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createInitialState, gameData } from '../core';
import {
  buildTower,
  etherLevel,
  type Group,
  lerpInput,
  MIST_LAYERS,
  normalizeSlot,
  type Part,
  scarsFromIds,
  type TowerInput,
  towerInputFromState,
} from './tower-model';
import { TOWER_PRESETS } from './tower-presets';

// renderTower из макета: вырезаем скрипт компонента и исполняем его как обычный JS.
interface MockPart {
  c: string;
  s: string;
  t: string;
}
interface MockResult {
  back: MockPart[];
  tower: MockPart[];
  front: MockPart[];
}
const html = readFileSync(new URL('../../design/project/Tower.dc.html', import.meta.url), 'utf8');
const script = html.slice(html.indexOf('data-props='), html.indexOf('class Component'));
const body = script.slice(script.indexOf('>') + 1);
const mock = new Function(`${body}; return { renderTower, TOWER_PRESETS };`)() as {
  renderTower: (s: unknown, o?: unknown) => MockResult;
  TOWER_PRESETS: Record<string, unknown>;
};

const MAIN = ['day2', 'good', 'bad', 'scars', 'harbor'] as const;
const all = (m: ReturnType<typeof buildTower>) => m.groups.flatMap((g) => g.parts);
const byClass = (m: ReturnType<typeof buildTower>, c: string) =>
  all(m).filter((p) => p.c.split(' ').includes(c));

/** Класс без признаков, которые зависят от случайности окна/жителя. */
function stable(c: string): string {
  return c
    .replace(/^p /, '')
    .split(' ')
    .filter((x) => x !== 'on' && x !== 'broken')
    .join(' ');
}
function num(s: string, key: string): number {
  const m = new RegExp(`(?:^|;)${key}:(-?[\\d.]+)px`).exec(s);
  return m ? Number(m[1]) : Number.NaN;
}
type Box = { c: string; x: number; y: number; w: number; h: number };
const sortBoxes = (a: Box[]) =>
  [...a].sort((p, q) => p.c.localeCompare(q.c) || p.y - q.y || p.x - q.x || p.w - q.w);

describe('модель башни совпадает с renderTower макета', () => {
  it('пресеты игры — те же, что в макете', () => {
    for (const name of MAIN) expect(TOWER_PRESETS[name]).toEqual(mock.TOWER_PRESETS[name]);
  });

  for (const name of MAIN) {
    it(`${name}: те же детали в тех же местах`, () => {
      const s = TOWER_PRESETS[name] as TowerInput;
      const ref = mock.renderTower(s, { W: 900 });
      const model = buildTower(s);
      const n = s.tiers.length;
      const topM = s.altitude + 10 * n + 22;
      const botY = Math.round((topM - s.altitude) * 12.5 * 10) / 10;
      const mY = Math.round((topM - s.mist) * 12.5 * 10) / 10;
      const skip = new Set(['mist', 'underglow', 'glow', 'cloud', 'man']);
      const refBoxes: Box[] = [...ref.tower, ...ref.front]
        .filter((p) => !skip.has(stable(p.c).split(' ')[0] ?? ''))
        .map((p) => ({
          c: stable(p.c),
          x: num(p.s, 'left'),
          y: num(p.s, 'top'),
          w: num(p.s, 'width'),
          h: num(p.s, 'height'),
        }));
      const ours: Box[] = model.groups.flatMap((g: Group) =>
        g.parts
          .filter((p: Part) => !skip.has(p.c.split(' ')[0] ?? ''))
          .map((p: Part) => ({
            c: stable(p.c),
            x: p.x + 450,
            y: p.y + (MIST_LAYERS.has(g.layer) ? mY : botY),
            w: p.w,
            h: p.h,
          })),
      );
      expect(ours.length).toBe(refBoxes.length);
      const a = sortBoxes(ours);
      const b = sortBoxes(refBoxes);
      a.forEach((p, i) => {
        const q = b[i] as Box;
        expect(p.c).toBe(q.c);
        expect(Math.abs(p.x - q.x)).toBeLessThan(0.25);
        expect(Math.abs(p.y - q.y)).toBeLessThan(0.25);
        expect(Math.abs(p.w - q.w)).toBeLessThan(0.25);
        expect(Math.abs(p.h - q.h)).toBeLessThan(0.25);
      });
      // Жители: то же число, что и в макете
      const refMen = [...ref.tower, ...ref.front].filter((p) => stable(p.c).startsWith('man')).length;
      expect(byClass(model, 'man').length).toBe(refMen);
    });
  }
});

describe('реакция на показатели (ТЗ 7.4)', () => {
  const base = TOWER_PRESETS.day2 as TowerInput;
  const withStats = (patch: Partial<TowerInput['stats']>, extra: Partial<TowerInput> = {}) =>
    buildTower({ ...base, ...extra, stats: { ...base.stats, ...patch } });

  it('здоровье: доля горящих окон растёт, при низком — серый налёт и сухие грядки', () => {
    const lit = (h: number) => byClass(withStats({ health: h }), 'on').length;
    expect(lit(15)).toBe(0);
    expect(lit(40)).toBeLessThan(lit(70));
    expect(lit(85)).toBe(byClass(withStats({ health: 85 }), 'win').length);
    const sick = withStats({ health: 20 });
    expect(byClass(sick, 'film').length).toBe(1);
    expect(byClass(sick, 'dry').length).toBeGreaterThan(0);
    expect(byClass(withStats({ health: 80 }), 'bush').length).toBeGreaterThan(0);
  });

  it('доверие: звезда горит, мигает, гаснет', () => {
    expect(withStats({ trust: 70 }).starMode).toBe('on');
    expect(withStats({ trust: 45 }).starMode).toBe('blink');
    const off = withStats({ trust: 20 });
    expect(off.starMode).toBe('off');
    expect(byClass(off, 'off').length).toBe(3);
    expect(byClass(off, 'placard').length).toBe(1);
  });

  it('порядок: разбитые стёкла и дым при низком, фонари патрулей при высоком', () => {
    const low = withStats({ order: 20 });
    expect(byClass(low, 'broken').length).toBeGreaterThan(0);
    expect(low.groups.some((g) => g.layer === 'smoke')).toBe(true);
    expect(byClass(withStats({ order: 80 }), 'lantern').length).toBeGreaterThan(0);
  });

  it('солидарность: баррикады при низкой, флажки при высокой', () => {
    expect(byClass(withStats({ solidarity: 20 }), 'crate').length).toBeGreaterThan(0);
    expect(byClass(withStats({ solidarity: 80 }), 'garland').length).toBeGreaterThan(0);
  });

  it('эфир: ядро тускнеет, подушка рвётся, башня кренится', () => {
    const full = buildTower({ ...base, ether: 1 });
    const low = buildTower({ ...base, ether: 0.2 });
    const coreOp = (m: ReturnType<typeof buildTower>) =>
      Number(/opacity:([\d.]+)/.exec(byClass(m, 'core')[0]?.s ?? '')?.[1]);
    expect(coreOp(low)).toBeLessThan(coreOp(full));
    expect(full.cushionWeak).toBe(false);
    expect(low.cushionWeak).toBe(true);
    expect(byClass(low, 'weak').length).toBe(3);
    expect(full.tilt).toBe(0);
    expect(low.tilt).toBeGreaterThan(0);
    // Почти без эфира волны давления пропадают
    expect(byClass(buildTower({ ...base, ether: 0.1 }), 'shock').length).toBe(0);
  });

  it('Мгла: слои Мглы сдвинуты на зазор, у Корня — иней и клубы', () => {
    const m = buildTower(base);
    expect(Math.abs(m.gapPx - (60 - 23.1) * 12.5)).toBeLessThanOrEqual(0.06);
    expect(m.close).toBe(false);
    const near = buildTower({ ...base, mist: 55 });
    expect(near.close).toBe(true);
    expect(byClass(near, 'icicles').length).toBe(1);
    expect(byClass(near, 'frost').length).toBeGreaterThan(0);
    expect(byClass(near, 'wisp').length).toBe(2);
  });

  it('брошенный ярус: окна не горят, людей нет, пелена', () => {
    const m = buildTower(TOWER_PRESETS.abandoned as TowerInput);
    const root = m.groups.find((g) => g.id === 'tier:root');
    expect(root?.parts.some((p) => p.c.split(' ').includes('on'))).toBe(false);
    expect(root?.parts.some((p) => p.c.startsWith('man'))).toBe(false);
    expect(root?.parts.some((p) => p.c === 'film abandoned')).toBe(true);
  });
});

describe('группы и ключи', () => {
  it('ключи уникальны внутри группы, группы — в общем списке', () => {
    for (const s of Object.values(TOWER_PRESETS)) {
      const m = buildTower(s as TowerInput);
      const ids = m.groups.map((g) => g.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const g of m.groups) expect(new Set(g.parts.map((p) => p.k)).size).toBe(g.parts.length);
    }
  });

  it('новый ярус не меняет детали Корня и сдвигает Шпиль на 10 м', () => {
    const a = TOWER_PRESETS.day2 as TowerInput;
    const b: TowerInput = {
      ...a,
      tiers: [
        a.tiers[0],
        a.tiers[1],
        { kind: 'tier', slots: [null, null, null] },
        a.tiers[2],
      ] as TowerInput['tiers'],
    };
    const ma = buildTower(a);
    const mb = buildTower(b);
    const g = (m: typeof ma, id: string) => m.groups.find((x) => x.id === id);
    expect(g(mb, 'tier:root')?.parts).toEqual(g(ma, 'tier:root')?.parts);
    expect(g(mb, 'tier:tier2')).toBeDefined();
    expect((g(mb, 'tier:spire')?.anchorY ?? 0) - (g(ma, 'tier:spire')?.anchorY ?? 0)).toBe(-125);
  });

  it('высота и Мгла меняют только зазор, а не детали ярусов', () => {
    const a = TOWER_PRESETS.good as TowerInput;
    const ma = buildTower(a);
    const mb = buildTower({ ...a, altitude: a.altitude + 4, mist: a.mist + 2 });
    expect(mb.gapPx - ma.gapPx).toBeCloseTo(25, 5);
    for (const id of ['tier:root', 'tier:tier1', 'tier:spire'])
      expect(mb.groups.find((x) => x.id === id)?.parts).toEqual(ma.groups.find((x) => x.id === id)?.parts);
  });

  it('промежуточные кадры перехода идут монотонно', () => {
    const a = TOWER_PRESETS.day2 as TowerInput;
    const b = TOWER_PRESETS.bad as TowerInput;
    const frames = [0, 0.25, 0.5, 0.75, 1].map((t) => buildTower(lerpInput(a, b, t)));
    const gaps = frames.map((f) => f.gapPx);
    const tilts = frames.map((f) => f.tilt);
    for (let i = 1; i < gaps.length; i++) {
      expect(gaps[i]).toBeLessThan(gaps[i - 1] as number);
      expect(tilts[i]).toBeGreaterThanOrEqual(tilts[i - 1] as number);
    }
    expect(gaps[0]).toBeCloseTo(buildTower(a).gapPx, 5);
    expect(gaps[4]).toBeCloseTo(buildTower(b).gapPx, 5);
  });
});

describe('из состояния игры', () => {
  it('стартовая башня: три яруса, стадии по умолчанию, эфир по запасу', () => {
    const st = createInitialState(gameData.balance, 1);
    const input = towerInputFromState(st, gameData.balance);
    expect(input.tiers.map((t) => t.kind)).toEqual(['root', 'tier', 'spire']);
    expect(input.ether).toBeGreaterThan(0.5);
    expect(input.ether).toBeLessThanOrEqual(1);
    expect(etherLevel({ ...st, res: { ...st.res, ether: 0 } }, gameData.balance)).toBe(0);
    expect(buildTower(input).groups.length).toBeGreaterThan(5);
  });

  it('слоты: строка — стадия 1, Ядро и Совет — 2, объект — своя стадия', () => {
    expect(normalizeSlot('farm')).toEqual({ b: 'farm', stage: 1 });
    expect(normalizeSlot('core')).toEqual({ b: 'core', stage: 2 });
    expect(normalizeSlot({ b: 'farm', stage: 3 })).toEqual({ b: 'farm', stage: 3 });
    expect(normalizeSlot('salvage')).toEqual({ b: 'scrap', stage: 1 });
    expect(normalizeSlot(null)).toBeNull();
  });

  it('шрамы: заплата на каждый, сброшенный ярус — обрубок и табличка', () => {
    expect(scarsFromIds([], 3)).toBeUndefined();
    expect(scarsFromIds(['barricade'], 3)?.patches?.length).toBe(1);
    const d = scarsFromIds(['barricade', 'drop_tier'], 4);
    expect(d?.stumpAt).toBe(1);
    expect(d?.memorial).toBe(true);
  });
});
