// Звуковой движок: один AudioContext на игру, шины музыки и звуков, общий «зал» (реверберация),
// настройки громкости в localStorage (`sedmaya.audio`). Звуков из файлов нет: всё синтезируется
// осцилляторами и шумом (sfx.ts, music.ts), поэтому лицензии и загрузка не нужны.
// Порядок: initAudio (index.ts) → engine.unlockOn(window) — контекст создаётся и запускается на первом
// касании, клике или клавише (иначе браузер телефона не даст звука) → sfx/music берут engine.ctx.

/** Мелодия дня (окно «Настройки»): ночь и финал звучат своими темами при любой. */
export type Melody = 'waltz' | 'march' | 'wind';
export const MELODIES: Melody[] = ['waltz', 'march', 'wind'];

export interface AudioSettings {
  /** «Без звука»: всё молчит, остальные настройки сохраняются. */
  muted: boolean;
  /** Общая громкость 0..1. */
  master: number;
  /** Громкость музыки 0..1. */
  music: number;
  /** Громкость звуков 0..1. */
  sfx: number;
  musicOn: boolean;
  sfxOn: boolean;
  melody: Melody;
}

export const SETTINGS_KEY = 'sedmaya.audio';
export const DEFAULT_SETTINGS: AudioSettings = {
  muted: false,
  master: 1,
  music: 0.6,
  sfx: 0.8,
  musicOn: true,
  sfxOn: true,
  melody: 'waltz',
};

/** Общий уровень всего звука до шин: запас, чтобы аккорды и удары не перегружали выход. */
const MASTER_LEVEL = 0.8;
/** Мягкий переход громкости при включении, выключении и смене уровней, с. */
const VOLUME_RAMP = 0.25;

const clamp01 = (n: unknown, fallback: number) =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;

/** Разбор сохранённых настроек: битая или чужая запись — значения по умолчанию. */
export function parseSettings(raw: string | null): AudioSettings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const v = JSON.parse(raw) as Partial<AudioSettings> | null;
    if (!v || typeof v !== 'object') return { ...DEFAULT_SETTINGS };
    return {
      muted: v.muted === true,
      master: clamp01(v.master, DEFAULT_SETTINGS.master),
      music: clamp01(v.music, DEFAULT_SETTINGS.music),
      sfx: clamp01(v.sfx, DEFAULT_SETTINGS.sfx),
      musicOn: v.musicOn !== false,
      sfxOn: v.sfxOn !== false,
      melody: MELODIES.includes(v.melody as Melody) ? (v.melody as Melody) : DEFAULT_SETTINGS.melody,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function loadSettings(): AudioSettings {
  try {
    return parseSettings(window.localStorage.getItem(SETTINGS_KEY));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(s: AudioSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // приватный режим или запрет хранилища: настройка живёт до перезагрузки
  }
}

type Ctor = typeof AudioContext;

export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  musicBus!: GainNode;
  sfxBus!: GainNode;
  /** Вход реверберации: и музыка, и звуки посылают сюда часть сигнала. */
  reverb!: GainNode;
  settings: AudioSettings = loadSettings();
  /** Последние сыгранные звуки (имя и время контекста) — для отладки из консоли. */
  played: [string, number][] = [];
  private noise: AudioBuffer | null = null;
  private readyListeners = new Set<() => void>();
  private settingsListeners = new Set<(s: AudioSettings) => void>();

  get ready(): boolean {
    return this.ctx?.state === 'running';
  }

  /** Вызывается, когда контекст впервые заработал (после жеста пользователя). */
  onReady(fn: () => void): void {
    if (this.ready) fn();
    else this.readyListeners.add(fn);
  }

  onSettings(fn: (s: AudioSettings) => void): () => void {
    this.settingsListeners.add(fn);
    return () => this.settingsListeners.delete(fn);
  }

  /** Разблокировка на первом жесте: pointerdown/touchend/keydown, слушатели снимаются после запуска. */
  unlockOn(target: Window): void {
    const events = ['pointerdown', 'touchend', 'keydown', 'click'] as const;
    const handler = () => {
      this.resume();
      if (this.ready) for (const e of events) target.removeEventListener(e, handler, true);
    };
    for (const e of events) target.addEventListener(e, handler, true);
    // Свёрнутая вкладка: звук на паузу, чтобы не тратить батарею и не копить запаздывающие ноты
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend().catch(() => undefined);
      else this.resume();
    });
  }

  /** Создать контекст при первом вызове и запустить его. Без Web Audio — тихо ничего не делает. */
  resume(): void {
    if (!this.ctx) {
      const C: Ctor | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
      if (!C) return;
      try {
        this.ctx = new C({ latencyHint: 'interactive' });
      } catch {
        return;
      }
      this.build(this.ctx);
    }
    const ctx = this.ctx;
    if (ctx.state !== 'running') {
      // iOS: короткий пустой буфер внутри жеста окончательно открывает вывод
      const b = ctx.createBufferSource();
      b.buffer = ctx.createBuffer(1, 1, 22050);
      b.connect(ctx.destination);
      b.start(0);
      void ctx
        .resume()
        .then(() => this.fireReady())
        .catch(() => undefined);
    } else this.fireReady();
  }

  private fireReady(): void {
    if (!this.ready) return;
    const list = [...this.readyListeners];
    this.readyListeners.clear();
    for (const fn of list) fn();
  }

  private build(ctx: AudioContext): void {
    this.master = ctx.createGain();
    this.master.gain.value = this.levels().master;
    // Мягкий ограничитель: громкие наложения не хрипят на динамике телефона
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.005;
    comp.release.value = 0.25;
    this.master.connect(comp).connect(ctx.destination);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.levels().music;
    this.musicBus.connect(this.master);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.levels().sfx;
    this.sfxBus.connect(this.master);

    // Реверберация «большого зала»: импульс из затухающего шума, 2,6 с
    const conv = ctx.createConvolver();
    conv.buffer = makeImpulse(ctx, 2.6, 2.4);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.reverb = ctx.createGain();
    this.reverb.connect(conv).connect(wet).connect(this.master);
  }

  /** Двухсекундный белый шум для ветра, шелеста и ударов; создаётся один раз. */
  noiseBuffer(): AudioBuffer | null {
    if (!this.ctx) return null;
    if (!this.noise) {
      const len = this.ctx.sampleRate * 2;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      let seed = 0x5eed;
      for (let i = 0; i < len; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        d[i] = (seed / 0xffffffff) * 2 - 1;
      }
      this.noise = buf;
    }
    return this.noise;
  }

  update(patch: Partial<AudioSettings>): void {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
    const ctx = this.ctx;
    if (ctx) {
      const t = ctx.currentTime;
      const l = this.levels();
      ramp(this.master.gain, l.master, t, VOLUME_RAMP);
      ramp(this.musicBus.gain, l.music, t, VOLUME_RAMP);
      ramp(this.sfxBus.gain, l.sfx, t, VOLUME_RAMP);
    }
    for (const fn of this.settingsListeners) fn(this.settings);
  }

  /** Действующие уровни шин с учётом «Без звука» и выключателей музыки и звуков. */
  levels(): { master: number; music: number; sfx: number } {
    const s = this.settings;
    return {
      master: s.muted ? 0 : MASTER_LEVEL * s.master,
      music: s.musicOn ? s.music : 0,
      sfx: s.sfxOn ? s.sfx : 0,
    };
  }

  /** Музыку есть смысл сочинять: звук не выключен целиком и музыка включена. */
  get musicAudible(): boolean {
    return !this.settings.muted && this.settings.musicOn;
  }

  get sfxAudible(): boolean {
    return !this.settings.muted && this.settings.sfxOn;
  }

  toggleMuted(): void {
    this.update({ muted: !this.settings.muted });
    // Включили звук жестом — заодно разблокируем контекст, если его ещё не было
    if (!this.settings.muted) this.resume();
  }
}

/** Плавно довести параметр до значения от текущего, без щелчков. */
export function ramp(p: AudioParam, value: number, t: number, dur: number): void {
  p.cancelScheduledValues(t);
  p.setValueAtTime(p.value, t);
  p.linearRampToValueAtTime(value, t + dur);
}

function makeImpulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  let seed = 0x7a11;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      d[i] = ((seed / 0xffffffff) * 2 - 1) * (1 - i / len) ** decay;
    }
  }
  return buf;
}

export const midiToHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

/** Маленький генератор с сидом для музыки: тот же характер мелодии без Math.random. */
export function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
