// Звуки из файлов с синтезированной заменой. Манифест SAMPLES: имя → файл в public/sounds/ (mp3 моно),
// отметки фрагментов, громкость и замена из sfx.ts. Файлы грузятся лениво: preloadSamples после
// разблокировки звука (fetch + decodeAudioData, кэш на всю игру) или при первом playSample.
// Пока файла нет (не положен, офлайн, битый путь, ещё грузится) — играет замена: игра не молчит и не ломается.
// Новый файл подхватывается без правки кода: положить в public/sounds/ и вписать `file` в манифест.
import type { AudioEngine } from './audio';
import { playSfx, type SfxName } from './sfx';
import { panTo } from './synth';

export interface SampleDef {
  /** Путь от корня сайта без ведущего `/` (`sounds/lever.mp3`); нет — файла пока нет, играет замена. */
  file?: string;
  /** Фрагменты файла [начало, длина] в секундах: один файл — несколько разных скрипов. */
  offsets?: [number, number][];
  /** Громкость, доля шины звуков. */
  gain: number;
  /** Синтезированная замена, пока файла нет. */
  fallback: SfxName;
}

/** Файлы срезов 2 и 6 плана звука; пока `file` не вписан, звучит замена. */
export type SampleName = 'creakMetal' | 'creakWood' | 'paperTear' | 'lever' | 'radioVoice';

// Файлы среза 2 — паки Kenney (CC0), собраны `npm run sounds` (tools/make-sounds.mjs), источники и
// обработка — public/sounds/CREDITS.md. Отметки `offsets` печатает та же сборка: после пересборки
// файла их переписывают сюда. Есть ли файлы на месте и укладываются ли в 300 КБ — tools/check-data.js.
export const SAMPLES: Record<SampleName, SampleDef> = {
  creakMetal: { file: 'sounds/creak-metal.mp3', gain: 0.6, fallback: 'demolish' },
  creakWood: {
    file: 'sounds/creak-wood.mp3',
    offsets: [
      [0, 0.626],
      [0.836, 0.784],
      [1.83, 0.336],
      [2.376, 1.151],
      [3.738, 1.026],
    ],
    gain: 0.5,
    fallback: 'tab',
  },
  paperTear: {
    file: 'sounds/paper-tear.mp3',
    offsets: [
      [0, 0.666],
      [0.876, 0.423],
      [1.508, 0.297],
    ],
    // листок тише скрипов по природе: громкость поднята до уровня бывшей замены `paper`
    gain: 1,
    fallback: 'paper',
  },
  lever: { file: 'sounds/lever.mp3', gain: 0.6, fallback: 'click' },
  // Срез 6: голос «Всем! Всем! Всем!» (radio-vsem.mp3) — пока замена
  radioVoice: { gain: 0.8, fallback: 'eventOpen' },
};

export const SAMPLE_NAMES = Object.keys(SAMPLES) as SampleName[];

/** Короткий подъём и спад на краях фрагмента, с: вырезка из середины файла не щёлкает. */
const EDGE_FADE = 0.005;

/** Загрузчик: в игре — fetch, в тестах — подмена. */
export type Fetcher = (url: string) => Promise<ArrayBuffer>;

const defaultFetch: Fetcher = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.arrayBuffer();
};

/** Декодированные файлы: путь → буфер (null — не удалось, больше не пытаемся). */
const decoded = new Map<string, AudioBuffer | null>();
const pending = new Map<string, Promise<AudioBuffer | null>>();

/** Загрузить и декодировать файл один раз; ошибка — null (играет замена). */
export function loadSample(
  ctx: Pick<BaseAudioContext, 'decodeAudioData'>,
  file: string,
  fetcher: Fetcher = defaultFetch,
): Promise<AudioBuffer | null> {
  if (decoded.has(file)) return Promise.resolve(decoded.get(file) ?? null);
  let p = pending.get(file);
  if (!p) {
    p = fetcher(file)
      .then((data) => ctx.decodeAudioData(data))
      .catch(() => null)
      .then((buf) => {
        decoded.set(file, buf);
        pending.delete(file);
        return buf;
      });
    pending.set(file, p);
  }
  return p;
}

/** Уже загруженный буфер или null (не загружен, ещё грузится или не удалось). */
export function sampleBuffer(name: SampleName, manifest = SAMPLES): AudioBuffer | null {
  const file = manifest[name].file;
  return (file && decoded.get(file)) || null;
}

/** Сбросить кэш (тесты). */
export function resetSampleCache(): void {
  decoded.clear();
  pending.clear();
}

/** Загрузить все файлы манифеста; вызывается после разблокировки звука. */
export function preloadSamples(e: AudioEngine, fetcher?: Fetcher, manifest = SAMPLES): Promise<unknown> {
  const ctx = e.ctx;
  if (!ctx) return Promise.resolve();
  return Promise.all(
    Object.values(manifest).flatMap((d) => (d.file ? [loadSample(ctx, d.file, fetcher)] : [])),
  );
}

/**
 * Какой кусок файла играть: номер фрагмента, иначе случайный из отметок (генератор звука), иначе весь.
 * Возвращает [начало, длина] в секундах файла.
 */
export function pickFragment(
  def: SampleDef,
  duration: number,
  rnd: () => number,
  index?: number,
): [number, number] {
  const list = def.offsets;
  if (!list?.length) return [0, duration];
  const i = index ?? Math.floor(rnd() * list.length);
  const [start, len] = list[Math.max(0, Math.min(list.length - 1, i))] as [number, number];
  const s = Math.max(0, Math.min(start, duration));
  return [s, Math.max(0, Math.min(len, duration - s))];
}

export interface SampleOpts {
  /** Скорость и высота вместе: 1 — как записано, 0,9 — ниже и дольше. */
  rate?: number;
  pan?: number;
  /** Номер фрагмента из `offsets`; не задан — случайный. */
  fragment?: number;
  /** Множитель громкости этого раза. */
  gain?: number;
  delay?: number;
  /** Куда играть вместо шины звуков. */
  dest?: AudioNode;
}

/**
 * Сыграть звук из файла; файла нет — его замену из sfx.ts (и начать загрузку на следующий раз).
 * Возвращает, что прозвучало: 'sample', 'fallback' или null (звук выключен или контекст не готов).
 */
export function playSample(
  e: AudioEngine,
  name: SampleName,
  opts: SampleOpts = {},
  manifest = SAMPLES,
): 'sample' | 'fallback' | null {
  const ctx = e.ctx;
  if (!ctx || !e.ready || !e.sfxAudible) return null;
  const def = manifest[name];
  const buf = sampleBuffer(name, manifest);
  if (!buf) {
    if (def.file) void loadSample(ctx, def.file);
    playSfx(e, def.fallback, opts.delay ?? 0, { pan: opts.pan, gain: opts.gain, dest: opts.dest });
    return 'fallback';
  }
  const rate = Math.max(0.25, Math.min(4, opts.rate ?? 1));
  const [start, len] = pickFragment(def, buf.duration, e.rnd, opts.fragment);
  const t = ctx.currentTime + 0.01 + (opts.delay ?? 0);
  const dur = len / rate;
  const fade = Math.min(EDGE_FADE, dur / 4);
  const level = def.gain * (opts.gain ?? 1);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + fade);
  g.gain.setValueAtTime(level, t + dur - fade);
  g.gain.linearRampToValueAtTime(0, t + dur);
  src.connect(g).connect(panTo(ctx, opts.dest ?? e.sfxBus, opts.pan, t));
  src.start(t, start, len);
  src.stop(t + dur + 0.02);
  e.played.push([`sample:${name}`, Math.round(t * 100) / 100]);
  if (e.played.length > 40) e.played.shift();
  return 'sample';
}
