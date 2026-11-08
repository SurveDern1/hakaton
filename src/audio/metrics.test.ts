import { describe, expect, it } from 'vitest';
import { DuckStack, fillNoise } from './audio';
import {
  activeSec,
  checkMetrics,
  correlation,
  edgeDb,
  encodeWav,
  highShare,
  lufs,
  measureChannels,
  peakDb,
  rmsDb,
  tailDb,
} from './metrics';
import { loadSample, pickFragment, resetSampleCache, type SampleDef } from './samples';
import { vary, varyDb } from './synth';

const SR = 48000;

function sine(freq: number, amp: number, seconds: number, fadeMs = 0): Float32Array {
  const n = Math.round(seconds * SR);
  const fade = Math.round((fadeMs / 1000) * SR);
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const env = fade ? Math.min(1, i / fade, (n - 1 - i) / fade) : 1;
    d[i] = amp * env * Math.sin((2 * Math.PI * freq * i) / SR);
  }
  return d;
}

describe('метрики звука', () => {
  it('синус 1 кГц: пик, RMS и громкость BS.1770', () => {
    const s = sine(1000, 0.1, 3);
    expect(peakDb([s, s])).toBeCloseTo(-20, 1);
    expect(rmsDb([s, s])).toBeCloseTo(-23.01, 1);
    // стерео синус 1 кГц с пиком −20 дБFS по стандарту ≈ −20 LUFS, моно (один канал) — на 3 LU тише
    expect(lufs([s, s], SR)).toBeCloseTo(-20, 0);
    expect(lufs([s, new Float32Array(s.length)], SR)).toBeCloseTo(-23, 0);
  });

  it('громкость не зависит от частоты дискретизации', () => {
    const at = (sr: number) => {
      const n = sr * 2;
      const d = new Float32Array(n);
      for (let i = 0; i < n; i++) d[i] = 0.2 * Math.sin((2 * Math.PI * 1000 * i) / sr);
      return lufs([d, d], sr);
    };
    expect(Math.abs(at(44100) - at(48000))).toBeLessThan(0.1);
  });

  it('тишина: −∞ везде, доля верха 0, корреляция 1', () => {
    const z = new Float32Array(SR);
    expect(peakDb([z])).toBe(-Infinity);
    expect(lufs([z, z], SR)).toBe(-Infinity);
    expect(highShare([z], SR)).toBe(0);
    expect(correlation(z, z)).toBe(1);
    expect(activeSec([z], SR)).toBe(0);
  });

  it('ступенька — щелчок на краю, хвост не затих', () => {
    const step = new Float32Array(SR).fill(0.5);
    expect(edgeDb([step])).toBeCloseTo(-6, 0);
    expect(tailDb([step], SR)).toBeCloseTo(-6, 0);
    const smooth = sine(440, 0.5, 1, 20);
    expect(edgeDb([smooth])).toBeLessThan(-60);
  });

  it('доля энергии выше 150 Гц: низкий удар почти весь пропадает, 1 кГц — весь остаётся', () => {
    expect(highShare([sine(50, 0.5, 1)], SR)).toBeLessThan(0.05);
    expect(highShare([sine(1000, 0.5, 1)], SR)).toBeGreaterThan(0.95);
  });

  it('корреляция: моно 1, противофаза −1', () => {
    const s = sine(300, 0.3, 0.5);
    expect(correlation(s, s)).toBeCloseTo(1, 5);
    expect(
      correlation(
        s,
        s.map((v) => -v),
      ),
    ).toBeCloseTo(-1, 5);
  });

  it('пороги: короткий звук с хвостом и щелчком не проходит, тема — только по пикам', () => {
    const loud = new Float32Array(SR).fill(0.99);
    const m = measureChannels([loud, loud], [loud, loud], SR);
    const errs = checkMetrics(m, 'oneshot');
    expect(errs.some((e) => e.startsWith('пик'))).toBe(true);
    expect(errs.some((e) => e.startsWith('щелчок'))).toBe(true);
    expect(errs.some((e) => e.startsWith('хвост'))).toBe(true);
    const ok = sine(600, 0.3, 1, 30);
    const padded = new Float32Array(SR * 2);
    padded.set(ok, 100);
    const good = measureChannels([padded, padded], [padded, padded], SR);
    expect(checkMetrics(good, 'oneshot')).toEqual([]);
    expect(checkMetrics(measureChannels([loud], [loud], SR), 'loop')).toHaveLength(2);
  });

  it('WAV: заголовок RIFF, 16 бит, стерео', () => {
    const w = encodeWav([new Float32Array(10), new Float32Array(10)], SR);
    const v = new DataView(w.buffer);
    expect(String.fromCharCode(...w.subarray(0, 4))).toBe('RIFF');
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(SR);
    expect(w.length).toBe(44 + 10 * 2 * 2);
  });
});

describe('цветной шум', () => {
  const at = (color: 'white' | 'pink' | 'brown') => {
    const d = new Float32Array(SR * 2);
    fillNoise(d, color, 0x1234);
    return d;
  };
  it('розовый и коричневый нормированы, без постоянной составляющей, петля без скачка', () => {
    for (const c of ['pink', 'brown'] as const) {
      const d = at(c);
      expect(peakDb([d])).toBeCloseTo(20 * Math.log10(0.95), 2);
      const mean = d.reduce((a, b) => a + b, 0) / d.length;
      expect(Math.abs(mean)).toBeLessThan(0.01);
      expect(Math.abs((d[0] as number) - (d[d.length - 1] as number))).toBeLessThan(1e-6);
    }
  });
  it('чем «темнее» шум, тем меньше энергии выше 150 Гц', () => {
    const w = highShare([at('white')], SR);
    const p = highShare([at('pink')], SR);
    const b = highShare([at('brown')], SR);
    expect(w).toBeGreaterThan(p);
    expect(p).toBeGreaterThan(b);
  });
  it('один сид — один и тот же шум', () => {
    expect(at('pink')).toEqual(at('pink'));
  });
});

describe('приглушение с подсчётом ссылок', () => {
  it('два окна подряд не отпускают друг друга, действует самое глубокое', () => {
    const d = new DuckStack();
    expect(d.gain()).toBe(1);
    const a = d.hold(-6);
    const b = d.hold(-12);
    expect(d.gain()).toBeCloseTo(10 ** (-12 / 20));
    expect(d.release(b)).toBe(true);
    expect(d.gain()).toBeCloseTo(10 ** (-6 / 20));
    expect(d.release(b)).toBe(false);
    d.release(a);
    expect(d.gain()).toBe(1);
    expect(d.count).toBe(0);
  });
  it('положительное «приглушение» не делает громче', () => {
    const d = new DuckStack();
    d.hold(6);
    expect(d.gain()).toBe(1);
  });
});

describe('вариации повторов', () => {
  it('множитель в пределах ±%', () => {
    let x = 0;
    const rnd = () => {
      x = (x + 0.37) % 1;
      return x;
    };
    for (let i = 0; i < 50; i++) {
      const v = vary(rnd, 5);
      expect(v).toBeGreaterThanOrEqual(0.95);
      expect(v).toBeLessThanOrEqual(1.05);
      const g = varyDb(rnd, 2);
      expect(g).toBeGreaterThanOrEqual(10 ** (-2 / 20) - 1e-9);
      expect(g).toBeLessThanOrEqual(10 ** (2 / 20) + 1e-9);
    }
    expect(vary(() => 0.5, 10)).toBe(1);
  });
});

describe('файлы звуков с заменой', () => {
  const def: SampleDef = {
    gain: 1,
    fallback: 'click',
    offsets: [
      [0.2, 0.3],
      [1, 5],
    ],
  };
  it('фрагмент: по номеру, случайный, весь файл без отметок; не выходит за длину', () => {
    expect(pickFragment(def, 2, () => 0, 0)).toEqual([0.2, 0.3]);
    expect(pickFragment(def, 2, () => 0.99)).toEqual([1, 1]);
    expect(pickFragment({ gain: 1, fallback: 'click' }, 1.5, () => 0)).toEqual([0, 1.5]);
    expect(pickFragment(def, 2, () => 0, 9)).toEqual([1, 1]);
  });
  it('загрузка один раз, ошибка — null без повторов', async () => {
    resetSampleCache();
    let fetches = 0;
    const buf = { duration: 1 } as AudioBuffer;
    const ctx = { decodeAudioData: async () => buf };
    const ok = async () => {
      fetches += 1;
      return new ArrayBuffer(8);
    };
    const [a, b] = await Promise.all([
      loadSample(ctx, 'sounds/a.mp3', ok),
      loadSample(ctx, 'sounds/a.mp3', ok),
    ]);
    expect(a).toBe(buf);
    expect(b).toBe(buf);
    expect(fetches).toBe(1);
    const bad = async () => {
      fetches += 1;
      throw new Error('404');
    };
    expect(await loadSample(ctx, 'sounds/none.mp3', bad)).toBeNull();
    expect(await loadSample(ctx, 'sounds/none.mp3', bad)).toBeNull();
    expect(fetches).toBe(2);
  });
});
