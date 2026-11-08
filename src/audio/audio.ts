// Звуковой движок: один AudioContext на игру, шины музыки, атмосферы и звуков, приглушение музыки и
// атмосферы (duck), общий «зал» (реверберация), настройки громкости в localStorage (`sedmaya.audio`).
// Почти всё синтезируется осцилляторами и шумом (sfx.ts, music.ts); короткие «материальные» звуки —
// файлы с синтезированной заменой (samples.ts).
// Порядок: initAudio (index.ts) → engine.unlockOn(window) — контекст создаётся и запускается на первом
// касании, клике или клавише (иначе браузер телефона не даст звука) → sfx/music берут engine.ctx.
// Без колонок: AudioEngine.offline(секунды) — тот же граф на OfflineAudioContext → render() → metrics.ts.
// Уровни сведения (MASTER_LEVEL, ограничитель, поправки групп) — mix.ts.
import { LIMITER, MASTER_LEVEL } from './mix';

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
  /** Громкость атмосферы (ветер, двигатель, Мгла) 0..1. */
  ambience: number;
  musicOn: boolean;
  sfxOn: boolean;
  ambienceOn: boolean;
  melody: Melody;
}

export const SETTINGS_KEY = 'sedmaya.audio';
export const DEFAULT_SETTINGS: AudioSettings = {
  muted: false,
  master: 1,
  // с постоянным фоном музыка может быть тише (план звука, Р4)
  music: 0.5,
  sfx: 0.8,
  ambience: 0.7,
  musicOn: true,
  sfxOn: true,
  ambienceOn: true,
  melody: 'waltz',
};

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
      ambience: clamp01(v.ambience, DEFAULT_SETTINGS.ambience),
      musicOn: v.musicOn !== false,
      sfxOn: v.sfxOn !== false,
      ambienceOn: v.ambienceOn !== false,
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

/**
 * Размер буфера вывода. С 'interactive' (≈10 мс) телефон, занятый отрисовкой башни, не успевал
 * дописать буфер — музыка рассыпалась в треск и шум. Телефонам (грубый указатель) — 'playback',
 * остальным — 'balanced': задержка щелчков вырастает на десятки миллисекунд, на слух незаметно.
 */
function latencyHint(): AudioContextLatencyCategory {
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  return coarse ? 'playback' : 'balanced';
}

/** Шины, которые можно приглушить: музыка и атмосфера (фон). Звуки действий не приглушаются. */
export type DuckBus = 'music' | 'amb';
/** Цвет шума: белый — шипение, розовый — ровный «воздух», коричневый — гул и далёкий ветер. */
export type NoiseColor = 'white' | 'pink' | 'brown';

/**
 * Приглушение с подсчётом ссылок: каждое окно или голос держит своё, действует самое глубокое.
 * Два окна подряд не «отпускают» друг друга: пока держится хотя бы одно, шина остаётся тихой.
 */
export class DuckStack {
  private held = new Map<number, number>();
  private next = 1;

  hold(db: number): number {
    const id = this.next++;
    this.held.set(id, Math.min(0, db));
    return id;
  }

  /** true — приглушение было и снято (повторный вызов ничего не меняет). */
  release(id: number): boolean {
    return this.held.delete(id);
  }

  get count(): number {
    return this.held.size;
  }

  /** Множитель громкости: 1 без приглушений, иначе по самому глубокому. */
  gain(): number {
    let db = 0;
    for (const d of this.held.values()) db = Math.min(db, d);
    return 10 ** (db / 20);
  }
}

export interface OfflineOpts {
  sampleRate?: number;
  /** Настройки громкости для рендера; по умолчанию — значения по умолчанию, звук включён. */
  settings?: Partial<AudioSettings>;
}

export class AudioEngine {
  ctx: BaseAudioContext | null = null;
  master!: GainNode;
  /** Выход после ограничителя: сюда подключаются индикаторы лаборатории. */
  output!: AudioNode;
  musicBus!: GainNode;
  /** Атмосфера: ветер, двигатель, Мгла. Своя громкость и выключатель в настройках. */
  ambBus!: GainNode;
  sfxBus!: GainNode;
  /** Узлы приглушения после шин музыки и атмосферы: отдельно от громкости из настроек. */
  musicDuck!: GainNode;
  ambDuck!: GainNode;
  /** Вход реверберации: и музыка, и звуки посылают сюда часть сигнала. */
  reverb!: GainNode;
  settings: AudioSettings;
  /** Последние сыгранные звуки (имя и время контекста) — для отладки из консоли. */
  played: [string, number][] = [];
  /** Случайность звука (вариации высоты, громкости, панорамы) — своя, игровой GameState.rng не трогает. */
  rnd: () => number = makeRandom(0x50d);
  /** Рендер без колонок (OfflineAudioContext): готов сразу, без жеста. */
  readonly offlineMode: boolean;
  private noise = new Map<NoiseColor, AudioBuffer>();
  private ducks: Record<DuckBus, DuckStack> = { music: new DuckStack(), amb: new DuckStack() };
  private readyListeners = new Set<() => void>();
  private settingsListeners = new Set<(s: AudioSettings) => void>();

  constructor(opts: { settings?: AudioSettings; offline?: boolean } = {}) {
    this.offlineMode = opts.offline === true;
    this.settings = opts.settings ?? loadSettings();
  }

  /**
   * Тот же граф шин на OfflineAudioContext — для рендера и метрик без колонок и без жеста.
   * Выход четырёхканальный: 0–1 — после ограничителя (что слышно), 2–3 — до него (сумма шин).
   * Звуки ставятся как обычно (playSfx, playSample), затем `await e.render()`.
   */
  static offline(seconds: number, opts: OfflineOpts = {}): AudioEngine {
    const sampleRate = opts.sampleRate ?? 48000;
    const e = new AudioEngine({ settings: { ...DEFAULT_SETTINGS, ...opts.settings }, offline: true });
    const ctx = new OfflineAudioContext({
      numberOfChannels: 4,
      length: Math.ceil(seconds * sampleRate),
      sampleRate,
    });
    e.ctx = ctx;
    e.build(ctx);
    return e;
  }

  /** Отрендерить оффлайн-граф: [L, R] после ограничителя и [L, R] до него. */
  async render(): Promise<{ post: Float32Array[]; pre: Float32Array[]; sampleRate: number }> {
    const ctx = this.ctx;
    if (!(ctx && this.offlineMode)) throw new Error('render() — только для AudioEngine.offline()');
    const buf = await (ctx as OfflineAudioContext).startRendering();
    const ch = (i: number) => buf.getChannelData(i);
    return { post: [ch(0), ch(1)], pre: [ch(2), ch(3)], sampleRate: buf.sampleRate };
  }

  /**
   * Компенсация ограничителя без ослабления, дБ: тихий тон (−30 дБFS) прямо в master, выход против входа.
   * От неё metrics.limiterReduction отсчитывает ослабление (свойство reduction узла в оффлайн-рендере
   * Chrome не обновляется).
   */
  static async makeupDb(sampleRate = 48000): Promise<number> {
    const e = AudioEngine.offline(0.6, { sampleRate });
    const ctx = e.ctx as OfflineAudioContext;
    const o = ctx.createOscillator();
    o.frequency.value = 440;
    const g = ctx.createGain();
    g.gain.value = 10 ** (-30 / 20) / e.master.gain.value;
    o.connect(g).connect(e.master);
    o.start(0);
    const r = await e.render();
    const a = Math.round(0.3 * sampleRate);
    const rms = (c: Float32Array) => {
      let s = 0;
      for (let i = a; i < c.length; i++) s += (c[i] as number) ** 2;
      return s;
    };
    return 10 * Math.log10(rms(r.post[0] as Float32Array) / rms(r.pre[0] as Float32Array));
  }

  /** Живой контекст запущен жестом; оффлайновый готов всегда — у него своя готовность. */
  get ready(): boolean {
    if (this.offlineMode) return true;
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
      const ctx = this.live;
      if (!ctx) return;
      if (document.hidden) void ctx.suspend().catch(() => undefined);
      else this.resume();
    });
  }

  private get live(): AudioContext | null {
    return this.offlineMode ? null : (this.ctx as AudioContext | null);
  }

  /** Создать контекст при первом вызове и запустить его. Без Web Audio — тихо ничего не делает. */
  resume(): void {
    if (this.offlineMode) return;
    if (!this.ctx) {
      const C: Ctor | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
      if (!C) return;
      try {
        this.ctx = new C({ latencyHint: latencyHint() });
      } catch {
        return;
      }
      this.build(this.ctx);
    }
    const ctx = this.ctx as AudioContext;
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

  // Граф: music → musicDuck ┐
  //       amb   → ambDuck   ├→ master → ограничитель → выход
  //       sfx ──────────────┤
  //       reverb (зал) ─────┘
  private build(ctx: BaseAudioContext): void {
    const l = this.levels();
    this.master = ctx.createGain();
    this.master.gain.value = l.master;
    // Мягкий ограничитель: громкие наложения не хрипят на динамике телефона
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = LIMITER.threshold;
    comp.knee.value = LIMITER.knee;
    comp.ratio.value = LIMITER.ratio;
    comp.attack.value = LIMITER.attack;
    comp.release.value = LIMITER.release;
    this.master.connect(comp);
    this.output = comp;
    if (this.offlineMode) {
      // 4 канала: что слышно (после ограничителя) и сумма шин до него — для пиков в метриках
      const merge = ctx.createChannelMerger(4);
      const post = ctx.createChannelSplitter(2);
      const pre = ctx.createChannelSplitter(2);
      comp.connect(post);
      this.master.connect(pre);
      post.connect(merge, 0, 0);
      post.connect(merge, 1, 1);
      pre.connect(merge, 0, 2);
      pre.connect(merge, 1, 3);
      ctx.destination.channelCount = 4;
      ctx.destination.channelInterpretation = 'discrete';
      merge.connect(ctx.destination);
    } else comp.connect(ctx.destination);

    const bus = (level: number, to: AudioNode) => {
      const g = ctx.createGain();
      g.gain.value = level;
      g.connect(to);
      return g;
    };
    this.musicDuck = bus(1, this.master);
    this.ambDuck = bus(1, this.master);
    this.musicBus = bus(l.music, this.musicDuck);
    this.ambBus = bus(l.amb, this.ambDuck);
    this.sfxBus = bus(l.sfx, this.master);

    // Реверберация «большого зала»: импульс из затухающего шума, 2,6 с
    const conv = ctx.createConvolver();
    conv.buffer = makeImpulse(ctx, 2.6, 2.4);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.reverb = ctx.createGain();
    this.reverb.connect(conv).connect(wet).connect(this.master);
  }

  /**
   * Приглушить музыку или атмосферу на `db` (отрицательное) за `attack` с; вернуть функцию, которая
   * отпускает за `release` с. Держится самое глубокое из действующих приглушений.
   */
  duck(bus: DuckBus, db: number, attack = 0.15, release = 0.8): () => void {
    const stack = this.ducks[bus];
    const id = stack.hold(db);
    this.applyDuck(bus, attack);
    return () => {
      if (stack.release(id)) this.applyDuck(bus, release);
    };
  }

  /** Сколько приглушений держится на шине и итоговый множитель (для проверок и лаборатории). */
  ducking(bus: DuckBus): { count: number; gain: number } {
    const s = this.ducks[bus];
    return { count: s.count, gain: s.gain() };
  }

  private applyDuck(bus: DuckBus, time: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const node = bus === 'music' ? this.musicDuck : this.ambDuck;
    const t = ctx.currentTime;
    node.gain.cancelScheduledValues(t);
    node.gain.setValueAtTime(node.gain.value, t);
    // постоянная времени — треть заданного: к концу времени путь пройден на 95 %
    node.gain.setTargetAtTime(this.ducks[bus].gain(), t, Math.max(0.005, time / 3));
  }

  /**
   * Шум с сидом, создаётся один раз на цвет. Белый — 2 с (как раньше: старые звуки не меняются),
   * розовый и коричневый — 4 с, нормированы к пику 0,95.
   */
  noiseBuffer(color: NoiseColor = 'white'): AudioBuffer | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    let buf = this.noise.get(color);
    if (!buf) {
      const len = ctx.sampleRate * (color === 'white' ? 2 : 4);
      buf = ctx.createBuffer(1, len, ctx.sampleRate);
      fillNoise(buf.getChannelData(0), color, NOISE_SEED[color]);
      this.noise.set(color, buf);
    }
    return buf;
  }

  update(patch: Partial<AudioSettings>): void {
    this.settings = { ...this.settings, ...patch };
    if (!this.offlineMode) saveSettings(this.settings);
    const ctx = this.ctx;
    if (ctx) {
      const t = ctx.currentTime;
      const l = this.levels();
      ramp(this.master.gain, l.master, t, VOLUME_RAMP);
      ramp(this.musicBus.gain, l.music, t, VOLUME_RAMP);
      ramp(this.ambBus.gain, l.amb, t, VOLUME_RAMP);
      ramp(this.sfxBus.gain, l.sfx, t, VOLUME_RAMP);
    }
    for (const fn of this.settingsListeners) fn(this.settings);
  }

  /** Действующие уровни шин с учётом «Без звука» и выключателей музыки, атмосферы и звуков. */
  levels(): { master: number; music: number; amb: number; sfx: number } {
    const s = this.settings;
    return {
      master: s.muted ? 0 : MASTER_LEVEL * s.master,
      music: s.musicOn ? s.music : 0,
      amb: s.ambienceOn ? s.ambience : 0,
      sfx: s.sfxOn ? s.sfx : 0,
    };
  }

  /** Музыку есть смысл сочинять: звук не выключен целиком и музыка включена. */
  get musicAudible(): boolean {
    return !this.settings.muted && this.settings.musicOn;
  }

  /** Фон есть смысл держать: звук не выключен и атмосфера включена. */
  get ambienceAudible(): boolean {
    return !this.settings.muted && this.settings.ambienceOn;
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

const NOISE_SEED: Record<NoiseColor, number> = { white: 0x5eed, pink: 0x9147, brown: 0xb40a };

/** Плавно довести параметр до значения от текущего, без щелчков. */
export function ramp(p: AudioParam, value: number, t: number, dur: number): void {
  p.cancelScheduledValues(t);
  p.setValueAtTime(p.value, t);
  p.linearRampToValueAtTime(value, t + dur);
}

/**
 * Заполнить буфер шумом нужного цвета (чистая функция, тест рядом). Белый — как раньше, без нормировки.
 * Розовый — фильтр Пола Келлета (−3 дБ на октаву), коричневый — интеграл белого с утечкой
 * (−6 дБ на октаву); оба без постоянной составляющей и нормированы к пику 0,95.
 */
export function fillNoise(d: Float32Array, color: NoiseColor, seed: number): void {
  let s = seed >>> 0;
  const white = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 0xffffffff) * 2 - 1;
  };
  if (color === 'white') {
    for (let i = 0; i < d.length; i++) d[i] = white();
    return;
  }
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = white();
    if (color === 'pink') {
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    } else {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last;
    }
  }
  // концы сводятся к одному значению: петля буфера без щелчка на стыке (у коричневого он был бы слышен)
  const n = d.length;
  const first = d[0] ?? 0;
  const lastV = d[n - 1] ?? 0;
  for (let i = 0; i < n; i++) d[i] = (d[i] as number) - (first + ((lastV - first) * i) / Math.max(1, n - 1));
  let mean = 0;
  for (let i = 0; i < d.length; i++) mean += d[i] as number;
  mean /= d.length || 1;
  let peak = 0;
  for (let i = 0; i < d.length; i++) {
    const v = (d[i] as number) - mean;
    d[i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  if (peak > 0) for (let i = 0; i < d.length; i++) d[i] = ((d[i] as number) / peak) * 0.95;
}

function makeImpulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
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
