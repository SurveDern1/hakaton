// Файлы звуков среза 2: манифест, замена при битом пути, разброс громкости фрагментов.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AudioEngine } from './audio';
import { FRAGMENT_LU, fragmentSpread, sampleItems } from './lab';
import { loadSample, playSample, resetSampleCache, SAMPLE_NAMES, SAMPLES, type SampleDef } from './samples';

const sfxCalls: string[] = [];
vi.mock('./sfx', () => ({
  playSfx: (_e: unknown, name: string) => sfxCalls.push(name),
  SFX_NAMES: [],
}));

const publicDir = path.resolve(__dirname, '..', '..', 'public');

/** Движок, готовый играть; узлы не нужны — без буфера playSample до них не доходит. */
function fakeEngine(decode: () => Promise<AudioBuffer>): AudioEngine {
  return {
    ctx: { decodeAudioData: decode, currentTime: 0 },
    ready: true,
    sfxAudible: true,
    played: [],
    rnd: () => 0,
  } as unknown as AudioEngine;
}

afterEach(() => {
  resetSampleCache();
  sfxCalls.length = 0;
});

describe('манифест файлов', () => {
  it('файлы среза 2 лежат в public/sounds, mp3, путь без ведущего /', () => {
    for (const name of ['creakMetal', 'creakWood', 'paperTear', 'lever'] as const) {
      const file = SAMPLES[name].file;
      expect(file, name).toMatch(/^sounds\/[a-z-]+\.mp3$/);
      expect(fs.existsSync(path.join(publicDir, file as string)), file).toBe(true);
    }
  });
  it('отметки фрагментов идут по порядку и не накладываются', () => {
    for (const name of SAMPLE_NAMES) {
      const list = SAMPLES[name].offsets ?? [];
      let end = 0;
      for (const [start, len] of list) {
        expect(start, name).toBeGreaterThanOrEqual(end);
        expect(len, name).toBeGreaterThan(0.1);
        end = start + len;
      }
    }
    expect(SAMPLES.creakWood.offsets?.length).toBeGreaterThanOrEqual(4);
    expect(SAMPLES.paperTear.offsets?.length).toBeGreaterThanOrEqual(2);
  });
  it('лаборатория: у каждого фрагмента свой пункт, файл грузится до рендера и должен звучать сам', () => {
    const items = sampleItems('creakWood');
    expect(items.map((i) => i.id)).toEqual([
      'sample:creakWood',
      ...(SAMPLES.creakWood.offsets ?? []).map((_, i) => `sample:creakWood#${i}`),
    ]);
    expect(items.every((i) => i.expect === 'sample' && i.prepare)).toBe(true);
    // голос радио ещё без файла (срез 6): играет замена, это не ошибка
    expect(sampleItems('radioVoice')[0]?.expect).toBeUndefined();
  });
});

describe('замена, когда файла нет', () => {
  it('битый путь → fallback из sfx.ts, без исключений', async () => {
    const manifest: Record<string, SampleDef> = {
      ...SAMPLES,
      lever: { ...SAMPLES.lever, file: 'sounds/none.mp3' },
    };
    const e = fakeEngine(() => Promise.reject(new Error('битый файл')));
    // первый раз — файл ещё грузится, второй — загрузка не удалась: оба раза замена
    expect(playSample(e, 'lever', {}, manifest as typeof SAMPLES)).toBe('fallback');
    expect(await loadSample(e.ctx as AudioContext, 'sounds/none.mp3')).toBeNull();
    expect(playSample(e, 'lever', {}, manifest as typeof SAMPLES)).toBe('fallback');
    expect(sfxCalls).toEqual(['click', 'click']);
  });
});

describe('разброс громкости фрагментов', () => {
  it(`фрагмент дальше ±${FRAGMENT_LU} LU от средней по файлу — ошибка; целые файлы не сравниваются`, () => {
    const errs = fragmentSpread([
      { id: 'sample:creakWood', lufs: -10 },
      { id: 'sample:creakWood#0', lufs: -31.5 },
      { id: 'sample:creakWood#1', lufs: -31.5 },
      { id: 'sample:creakWood#2', lufs: -36 },
      { id: 'sample:paperTear#0', lufs: -25 },
      { id: 'sample:paperTear#1', lufs: -26 },
      { id: 'sfx:click', lufs: -60 },
    ]);
    expect([...errs.keys()]).toEqual(['sample:creakWood#2']);
  });
});
