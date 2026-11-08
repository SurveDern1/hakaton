// Звуковая лаборатория `?sound=lab`: все звуки, файлы с заменой, темы и сцены фона кнопками, ползунки
// состояния (режим двигателя, эфир, зазор до Мглы, фаза, подъём — фон сразу звучит по ним: soundscape →
// Ambience.pin), приглушение музыки и атмосферы, индикаторы пика и громкости по AnalyserNode на выходе и
// строка «что звучит» у двигателя (тон, срез, громкости слоёв).
// Без колонок и без жеста: sedmaya.sound.lab.measure() — рендер каждого звука на
// AudioEngine.offline и таблица метрик (metrics.ts); lab.wav(id) — WAV в base64, lab.exportWav(id) —
// скачать. Этим пользуется `npm run check:sound` (tools/check-sound.mjs).
import { Ambience, type AmbienceOpts } from './ambience';
import { AudioEngine, type DuckBus } from './audio';
import './lab.css';
import { playCalendar, playLever, playTierDrop } from './events';
import { checkMetrics, encodeWav, measureChannels, type SoundMetrics } from './metrics';
import { type Music, marchDrum, scheduleTheme, THEMES, type ThemeName } from './music';
import { playSample, preloadSamples, SAMPLE_NAMES, SAMPLES, type SampleName } from './samples';
import { playSfx, SFX_NAMES, type SfxName } from './sfx';
import { type AmbMoment, type AmbPhase, type AmbTargets, type SoundInput, soundscape } from './soundscape';

type Group = 'sfx' | 'event' | 'sample' | 'theme' | 'amb';

export interface LabItem {
  id: string;
  group: Group;
  /** oneshot — проверяются края и хвост; loop — тема или фон, обрезанные посреди звучания. */
  kind: 'oneshot' | 'loop';
  /** Длина рендера, с. */
  seconds: number;
  /** Поставить звук на движок (живой или оффлайновый) с начала; файл — что прозвучало (playSample). */
  schedule(e: AudioEngine): unknown;
  /** Подготовить движок до рендера (загрузить файлы звуков). */
  prepare?(e: AudioEngine): Promise<unknown>;
  /** Что должен вернуть schedule; иначе в таблице ошибка (файл не загрузился — играла замена). */
  expect?: 'sample';
  /** Пороги сверх общих (сцены фона): коридор громкости, доля выше 150 Гц, корреляция каналов. */
  limits?: { lufs?: [number, number]; highMin?: number; corrMax?: number };
  /** Цели фона: в живой лаборатории кнопка сцены закрепляет их на фоне игры. */
  targets?: AmbTargets;
}

export interface LabRow extends SoundMetrics {
  id: string;
  group: Group;
  kind: 'oneshot' | 'loop';
  errors: string[];
}

/** Состояние для фона: по нему лаборатория закрепляет цели Ambience (soundscape). */
export interface LabState {
  mode: 'hold' | 'climb' | 'save';
  /** Запас эфира 0..1. */
  aether: number;
  /** Зазор до Мглы, м. */
  mistGap: number;
  phase: 'day' | 'night' | 'morning';
  /** Подъём над стартовой высотой, м (0…80 — доля heightFrac). */
  height: number;
}

/** Сколько метров подъёма дают heightFrac = 1 (как tierHeight × maxTiers в балансе). */
const LAB_SPAN = 80;

/** Вход фона из ползунков лаборатории. */
export function labInput(s: LabState): SoundInput {
  return {
    mode: s.mode,
    ether: s.aether,
    mistGap: s.mistGap,
    tierHeight: 10,
    heightFrac: Math.max(0, Math.min(1, s.height / LAB_SPAN)),
    tiersInMist: s.mistGap < -5 ? 1 : 0,
    scars: 0,
  };
}

/** Длина рендера короткого звука: самый долгий (финал) плюс хвост зала 2,6 с. */
const ONESHOT_SECONDS = 9;
const THEME_SECONDS = 16;

const AMB_SECONDS = 10;

/** Спокойный день: двигатель держит высоту, эфира хватает, Мгла далеко. */
const DAY: LabState = { mode: 'hold', aether: 0.7, mistGap: 40, phase: 'day', height: 16 };
/** Коридор громкости сцены фона целиком, LUFS (уровни плана −30…−24 LUFS с запасом на сцены). */
const AMB_LUFS: [number, number] = [-34, -22];

type Layers = AmbienceOpts['layers'];
const ONLY_ENGINE: Layers = { engine: true, wind: false, mist: false, creak: false };
const ONLY_WIND: Layers = { wind: true, engine: false, mist: false, creak: false };

/** Сцена фона: 10 с рендера Ambience по целям soundscape; layers — только эти слои (замер по отдельности). */
function ambScene(
  id: string,
  s: Partial<Omit<LabState, 'phase'>> & { phase?: AmbPhase },
  limits: LabItem['limits'],
  layers?: Layers,
  moment?: AmbMoment,
): LabItem {
  const targets = soundscape(
    labInput({ ...DAY, ...s, phase: 'day' }),
    s.phase ?? DAY.phase,
    undefined,
    moment,
  );
  return {
    id: `amb:${id}`,
    group: 'amb',
    kind: 'loop',
    seconds: AMB_SECONDS,
    limits,
    targets,
    schedule(e) {
      const a = new Ambience(e, { layers });
      a.set(targets, true);
      a.start();
      a.schedule((e.ctx?.currentTime ?? 0) + AMB_SECONDS);
    },
  };
}

/** Сцены фона из плана: старт, три режима, мало эфира, Мгла близко, ночь; двигатель и ветер отдельно. */
function ambItems(): LabItem[] {
  const full = { lufs: AMB_LUFS };
  const engine = { highMin: 0.4 };
  const wind = { corrMax: 0.8 };
  return [
    ambScene('start', { phase: 'start' }, full),
    ambScene('hold', {}, full),
    ambScene('climb', { mode: 'climb' }, full),
    ambScene('save', { mode: 'save' }, full),
    ambScene('lowEther', { aether: 0.15 }, full),
    ambScene('mistNear', { mistGap: 4 }, full),
    ambScene('night', { phase: 'night', mistGap: 8 }, full),
    // Срез 4: подъём Мглы ночью и тон финала (двигатель и Мгла молчат, ветер остаётся)
    ambScene('nightRise', { phase: 'night', mistGap: 30 }, full, undefined, { rising: true }),
    ambScene('final@win', { phase: 'final' }, { lufs: FINAL_LUFS }, undefined, { verdict: 'win' }),
    ambScene('final@lose', { phase: 'final' }, { lufs: FINAL_LUFS }, undefined, { verdict: 'lose' }),
    ambScene('engine@save', { mode: 'save' }, engine, ONLY_ENGINE),
    ambScene('engine@hold', {}, engine, ONLY_ENGINE),
    ambScene('engine@climb', { mode: 'climb' }, engine, ONLY_ENGINE),
    ambScene('engine@lowEther', { aether: 0.15 }, engine, ONLY_ENGINE),
    ambScene('wind@day', {}, wind, ONLY_WIND),
    ambScene('wind@night', { phase: 'night' }, wind, ONLY_WIND),
  ];
}

/** Финал тише дневного фона: остаётся один ветер. */
const FINAL_LUFS: [number, number] = [-42, -26];

/** Удары, которые должны быть слышны на динамике телефона: доля энергии выше 150 Гц. */
export const HIT_HIGH_MIN = 0.3;
const HITS: SfxName[] = ['choice', 'final', 'tierDrop', 'lever'];

/** Звуки событий целиком (файл + синтез): сброс яруса, листок календаря, рычаг; барабан марша отдельно. */
function eventItems(): LabItem[] {
  const ev = (id: string, schedule: LabItem['schedule'], limits?: LabItem['limits']): LabItem => ({
    id: `event:${id}`,
    group: 'event',
    kind: 'oneshot',
    seconds: ONESHOT_SECONDS,
    prepare: (e) => preloadSamples(e),
    schedule,
    limits,
  });
  const hit = { highMin: HIT_HIGH_MIN };
  return [
    ev('tierDrop', (e) => playTierDrop(e, 2), hit),
    ev('calendar', (e) => playCalendar(e)),
    ev('calendarRed', (e) => playCalendar(e, true)),
    ev('lever@up', (e) => playLever(e, 1), hit),
    ev('lever@down', (e) => playLever(e, -1), hit),
    ev(
      'marchDrum',
      (e) => {
        const ctx = e.ctx;
        if (ctx) marchDrum(e, ctx.currentTime + 0.01, e.musicBus);
      },
      hit,
    ),
  ];
}

/** Нарушения порогов сцены сверх общих. */
export function checkLimits(m: SoundMetrics, limits: LabItem['limits']): string[] {
  const errs: string[] = [];
  if (!limits) return errs;
  const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '−∞');
  if (limits.lufs && !(m.lufs >= limits.lufs[0] && m.lufs <= limits.lufs[1]))
    errs.push(`громкость ${f(m.lufs)} LUFS вне коридора ${limits.lufs[0]}…${limits.lufs[1]}`);
  if (limits.highMin !== undefined && m.high < limits.highMin)
    errs.push(
      `выше 150 Гц ${Math.round(m.high * 100)} % < ${Math.round(limits.highMin * 100)} %: на телефоне не слышно`,
    );
  if (limits.corrMax !== undefined && m.corr >= limits.corrMax)
    errs.push(`корреляция каналов ${f(m.corr, 2)} ≥ ${limits.corrMax}: стерео схлопнулось`);
  return errs;
}

/** Всё, что лаборатория играет и меряет. Срезы фона и событий добавляют сюда свои пункты. */
export function labItems(): LabItem[] {
  return [
    ...SFX_NAMES.map(
      (name): LabItem => ({
        id: `sfx:${name}`,
        group: 'sfx',
        kind: 'oneshot',
        seconds: ONESHOT_SECONDS,
        schedule: (e) => playSfx(e, name),
        ...(HITS.includes(name) ? { limits: { highMin: HIT_HIGH_MIN } } : {}),
      }),
    ),
    ...eventItems(),
    {
      id: 'sfx:build@left',
      group: 'sfx',
      kind: 'oneshot',
      seconds: ONESHOT_SECONDS,
      schedule: (e) => playSfx(e, 'build', 0, { pan: -0.8 }),
    },
    ...SAMPLE_NAMES.flatMap(sampleItems),
    ...THEMES.map(
      (name): LabItem => ({
        id: `theme:${name}`,
        group: 'theme',
        kind: 'loop',
        seconds: THEME_SECONDS,
        schedule: (e) => scheduleTheme(e, name, THEME_SECONDS),
      }),
    ),
    ...ambItems(),
  ];
}

/**
 * Пункты файла: весь звук (`sample:creakWood`, случайный фрагмент) и каждый фрагмент отдельно
 * (`sample:creakWood#2`). Файл указан — рендер сперва его загружает, и играть должен файл, не замена.
 */
export function sampleItems(name: SampleName): LabItem[] {
  const def = SAMPLES[name];
  const base = {
    group: 'sample' as const,
    kind: 'oneshot' as const,
    seconds: ONESHOT_SECONDS,
    ...(def.file ? { prepare: (e: AudioEngine) => preloadSamples(e), expect: 'sample' as const } : {}),
  };
  return [
    { ...base, id: `sample:${name}`, schedule: (e) => playSample(e, name) },
    ...(def.offsets ?? []).map(
      (_, i): LabItem => ({
        ...base,
        id: `sample:${name}#${i}`,
        schedule: (e) => playSample(e, name, { fragment: i }),
      }),
    ),
  ];
}

/** Разброс громкости фрагментов одного файла, LU: допуск плана — ±2 LU от среднего. */
export const FRAGMENT_LU = 2;

/** Фрагменты (`sample:x#i`), чья громкость дальше FRAGMENT_LU от средней по файлу: id → ошибка. */
export function fragmentSpread(rows: Pick<LabRow, 'id' | 'lufs'>[]): Map<string, string> {
  const groups = new Map<string, Pick<LabRow, 'id' | 'lufs'>[]>();
  for (const r of rows) {
    const m = /^(sample:[^#]+)#\d+$/.exec(r.id);
    if (!m?.[1] || !Number.isFinite(r.lufs)) continue;
    groups.set(m[1], [...(groups.get(m[1]) ?? []), r]);
  }
  const out = new Map<string, string>();
  for (const list of groups.values()) {
    const mean = list.reduce((s, r) => s + r.lufs, 0) / list.length;
    for (const r of list)
      if (Math.abs(r.lufs - mean) > FRAGMENT_LU)
        out.set(
          r.id,
          `громкость фрагмента ${(r.lufs - mean).toFixed(1)} LU от средней по файлу (допуск ±${FRAGMENT_LU})`,
        );
  }
  return out;
}

/** Отрендерить пункт без колонок. */
export async function renderItem(
  item: LabItem,
): Promise<{ post: Float32Array[]; pre: Float32Array[]; sampleRate: number; played: unknown }> {
  const e = AudioEngine.offline(item.seconds);
  await item.prepare?.(e);
  const played = item.schedule(e);
  return { ...(await e.render()), played };
}

export async function measureItem(item: LabItem): Promise<LabRow> {
  const r = await renderItem(item);
  const m = measureChannels(r.pre, r.post, r.sampleRate);
  const errors = [...checkMetrics(m, item.kind), ...checkLimits(m, item.limits)];
  if (item.expect && r.played !== item.expect)
    errors.push(`играла замена (${String(r.played)}): файл не загрузился`);
  return { id: item.id, group: item.group, kind: item.kind, ...m, errors };
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}

export interface Lab {
  items: LabItem[];
  state: LabState;
  /** Подписка на ползунки состояния; сразу вызывается с текущим. */
  onState(fn: (s: LabState) => void): () => void;
  /** Таблица метрик по рендеру; `filter` — подстрока id. */
  measure(filter?: string): Promise<LabRow[]>;
  /** WAV пункта (после ограничителя) в base64 — для `SOUND_WAV` в check:sound. */
  wav(id: string): Promise<string>;
  /** Скачать WAV пункта. */
  exportWav(id: string): Promise<void>;
}

export interface LabDeps {
  engine: AudioEngine;
  music: Music;
  /** Фон игры: лаборатория закрепляет на нём цели своих ползунков и сцен. */
  ambience?: Ambience;
}

const fmt = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '−∞');

/** Страница лаборатории поверх игры. */
export function mountLab(host: HTMLElement, deps: LabDeps): Lab {
  const { engine, music, ambience } = deps;
  const items = labItems();
  const byId = new Map(items.map((i) => [i.id, i]));
  const find = (id: string) => {
    const it = byId.get(id);
    if (!it) throw new Error(`Нет звука ${id}; есть: ${[...byId.keys()].join(', ')}`);
    return it;
  };
  const state: LabState = { ...DAY };
  const stateListeners = new Set<(s: LabState) => void>();

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  const root = el('section', 'lab');
  root.setAttribute('aria-label', 'Звуковая лаборатория');
  const head = el('header', 'lab-head');
  head.append(el('h1', 'lab-title', 'Звуковая лаборатория'));
  const status = el('p', 'lab-status', 'Звук включится на первом нажатии.');
  status.setAttribute('role', 'status');
  head.append(status);

  // ---- Индикаторы на выходе ----
  const meters = el('div', 'lab-meters');
  const meter = (label: string) => {
    const wrap = el('div', 'lab-meter');
    const bar = el('div', 'lab-meter-bar');
    const fill = el('div', 'lab-meter-fill');
    const val = el('span', 'lab-meter-val', '−∞');
    bar.append(fill);
    wrap.append(el('span', 'lab-meter-label', label), bar, val);
    meters.append(wrap);
    return (db: number) => {
      const pct = Math.max(0, Math.min(1, (db + 60) / 60));
      fill.style.transform = `scaleX(${pct})`;
      fill.classList.toggle('is-hot', db > -1);
      val.textContent = `${fmt(db)} дБ`;
    };
  };
  const showPeak = meter('Пик');
  const showRms = meter('RMS 300 мс');
  head.append(meters);
  root.append(head);

  async function live(): Promise<boolean> {
    engine.resume();
    if (!engine.ready) await new Promise<void>((ok) => engine.onReady(ok));
    startMeters();
    return engine.ready;
  }

  let metersOn = false;
  function startMeters() {
    const ctx = engine.ctx;
    if (metersOn || !ctx) return;
    metersOn = true;
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    engine.output.connect(an);
    const buf = new Float32Array(an.fftSize);
    let peakHold = -Infinity;
    let rmsAcc = 0;
    const frame = () => {
      an.getFloatTimeDomainData(buf);
      let p = 0;
      let s = 0;
      for (const v of buf) {
        p = Math.max(p, Math.abs(v));
        s += v * v;
      }
      const db = p > 0 ? 20 * Math.log10(p) : -Infinity;
      peakHold = Math.max(db, peakHold - 0.6);
      // ~300 мс: экспоненциальное среднее по кадрам (60 кадров в секунду)
      rmsAcc = rmsAcc * 0.94 + (s / buf.length) * 0.06;
      showPeak(peakHold);
      showRms(rmsAcc > 0 ? 10 * Math.log10(rmsAcc) : -Infinity);
      const r = ambience?.readout();
      if (r)
        ambOut.textContent = `Двигатель: тон ${r.f0.toFixed(1)} Гц, срез ${Math.round(r.cutoff)} Гц, громкость ${r.engine.toFixed(2)} · ветер ${r.wind.toFixed(2)} · Мгла ${r.mist.toFixed(2)}`;
      if (root.isConnected) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // ---- Кнопки звуков ----
  const GROUPS: [Group, string][] = [
    ['sfx', 'Звуки действий'],
    ['event', 'События (файл + синтез)'],
    ['sample', 'Файлы (# — фрагмент; нет файла — замена)'],
    ['theme', 'Музыка'],
    ['amb', 'Фоны'],
  ];
  let pinnedScene: string | null = null;
  const markScene = () => {
    for (const b of root.querySelectorAll<HTMLElement>('[data-id^="amb:"]'))
      b.setAttribute('aria-pressed', String(b.dataset.id === pinnedScene));
  };
  const playLive = async (item: LabItem) => {
    if (!(await live())) return;
    if (item.group === 'theme') {
      const name = item.id.slice('theme:'.length) as ThemeName;
      music.set(music.current === name ? null : name);
      status.textContent = music.current ? `Музыка: ${music.current}` : 'Музыка остановлена';
      return;
    }
    if (item.group === 'amb' && item.targets && ambience) {
      // Сцена фона звучит вместо игровой, пока её не сняли повторным нажатием
      const off = pinnedScene === item.id;
      pinnedScene = off ? null : item.id;
      ambience.pin(off ? null : item.targets);
      markScene();
      status.textContent = off ? 'Фон: как в игре' : `Фон: ${item.id}`;
      return;
    }
    if (item.group === 'sample') {
      const [name, frag] = item.id.slice('sample:'.length).split('#') as [SampleName, string?];
      const r = playSample(engine, name, frag === undefined ? {} : { fragment: Number(frag) });
      status.textContent = `${item.id}: ${r === 'sample' ? 'файл' : r === 'fallback' ? 'замена' : 'звук выключен'}`;
      return;
    }
    // Короткий звук и фон ставятся на живой движок с текущего момента
    item.schedule(engine);
    status.textContent = `Играет ${item.id}`;
  };
  for (const [g, title] of GROUPS) {
    const sec = el('section', 'lab-group');
    sec.append(el('h2', 'lab-h', title));
    const list = el('div', 'lab-buttons');
    for (const it of items.filter((i) => i.group === g)) {
      const b = el('button', 'lab-btn', it.id.split(':')[1]);
      b.type = 'button';
      b.dataset.id = it.id;
      b.addEventListener('click', () => void playLive(it));
      list.append(b);
    }
    sec.append(list);
    root.append(sec);
  }

  // ---- Приглушение ----
  const duckSec = el('section', 'lab-group');
  duckSec.append(el('h2', 'lab-h', 'Приглушение'));
  const duckRow = el('div', 'lab-buttons');
  const duckBtn = (bus: DuckBus, label: string) => {
    let release: (() => void) | null = null;
    const b = el('button', 'lab-btn', label);
    b.type = 'button';
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', async () => {
      await live();
      if (release) {
        release();
        release = null;
      } else release = engine.duck(bus, -12);
      b.setAttribute('aria-pressed', String(!!release));
      const d = engine.ducking(bus);
      status.textContent = `${bus}: приглушений ${d.count}, множитель ${d.gain.toFixed(2)}`;
    });
    duckRow.append(b);
  };
  duckBtn('music', 'Музыка −12 дБ');
  duckBtn('music', 'Ещё окно −12 дБ');
  duckBtn('amb', 'Атмосфера −12 дБ');
  duckSec.append(duckRow);
  root.append(duckSec);

  // ---- Состояние для фона ----
  const stSec = el('section', 'lab-group');
  stSec.append(el('h2', 'lab-h', 'Состояние башни (для фона)'));
  const grid = el('div', 'lab-state');
  const ambOut = el('output', 'lab-amb', 'Фон заиграет после первого нажатия.');
  const emit = () => {
    for (const fn of stateListeners) fn({ ...state });
    if (!ambience) return;
    pinnedScene = null;
    markScene();
    void live().then(() => ambience.pin(soundscape(labInput(state), state.phase)));
  };
  const select = <K extends 'mode' | 'phase'>(key: K, label: string, opts: [LabState[K], string][]) => {
    const l = el('label', 'lab-field');
    l.append(el('span', '', label));
    const s = el('select');
    for (const [v, t] of opts) {
      const o = el('option', '', t);
      o.value = v;
      s.append(o);
    }
    s.value = state[key];
    s.addEventListener('change', () => {
      state[key] = s.value as LabState[K];
      emit();
    });
    l.append(s);
    grid.append(l);
  };
  const range = (
    key: 'aether' | 'mistGap' | 'height',
    label: string,
    min: number,
    max: number,
    step: number,
  ) => {
    const l = el('label', 'lab-field');
    const out = el('output', '', String(state[key]));
    const head = el('span');
    head.append(`${label}: `, out);
    const r = el('input');
    r.type = 'range';
    r.min = String(min);
    r.max = String(max);
    r.step = String(step);
    r.value = String(state[key]);
    r.addEventListener('input', () => {
      state[key] = Number(r.value);
      out.textContent = r.value;
      emit();
    });
    l.append(head, r);
    grid.append(l);
  };
  select('mode', 'Режим двигателя', [
    ['hold', 'Держать высоту'],
    ['climb', 'Набирать высоту'],
    ['save', 'Экономить эфир'],
  ]);
  select('phase', 'Фаза', [
    ['day', 'День'],
    ['night', 'Ночь'],
    ['morning', 'Утро'],
  ]);
  range('aether', 'Эфир', 0, 1, 0.05);
  range('mistGap', 'Зазор до Мглы, м', 0, 60, 1);
  range('height', 'Подъём над стартом, м', 0, LAB_SPAN, 1);
  stSec.append(grid, ambOut);
  root.append(stSec);

  // ---- Метрики ----
  const mSec = el('section', 'lab-group');
  mSec.append(el('h2', 'lab-h', 'Метрики по рендеру без колонок'));
  const mBtn = el('button', 'lab-btn lab-btn-main', 'Измерить всё');
  mBtn.type = 'button';
  const tableWrap = el('div', 'lab-table-wrap');
  mSec.append(mBtn, tableWrap);
  root.append(mSec);

  function drawTable(rows: LabRow[]) {
    const t = el('table', 'lab-table');
    const cols = ['звук', 'пик', 'после огр.', 'LUFS', 'край', 'хвост', '>150 Гц', 'корр.', 'длина', ''];
    const hr = el('tr');
    for (const c of cols) hr.append(el('th', '', c));
    t.append(hr);
    for (const r of rows) {
      const tr = el('tr', r.errors.length ? 'is-bad' : '');
      const cells = [
        r.id,
        fmt(r.peak),
        fmt(r.peakPost),
        fmt(r.lufs),
        fmt(r.edge, 0),
        fmt(r.tail, 0),
        `${Math.round(r.high * 100)} %`,
        fmt(r.corr, 2),
        `${fmt(r.length, 2)} с`,
        r.errors.join('; ') || 'ок',
      ];
      for (const c of cells) tr.append(el('td', '', c));
      const wavBtn = el('button', 'lab-link', 'WAV');
      wavBtn.type = 'button';
      wavBtn.addEventListener('click', () => void lab.exportWav(r.id));
      tr.lastElementChild?.append(' ', wavBtn);
      t.append(tr);
    }
    tableWrap.replaceChildren(t);
  }

  mBtn.addEventListener('click', async () => {
    mBtn.disabled = true;
    status.textContent = 'Рендер…';
    try {
      const rows = await lab.measure();
      drawTable(rows);
      const bad = rows.filter((r) => r.errors.length).length;
      status.textContent = bad ? `Нарушений: ${bad}` : `Все ${rows.length} звуков в порогах`;
    } catch (err) {
      status.textContent = `Ошибка: ${(err as Error).message}`;
    } finally {
      mBtn.disabled = false;
    }
  });

  document.body.append(root);
  host.classList.add('is-bare');

  const lab: Lab = {
    items,
    state,
    onState(fn) {
      stateListeners.add(fn);
      fn({ ...state });
      return () => stateListeners.delete(fn);
    },
    async measure(filter) {
      const rows: LabRow[] = [];
      for (const it of items) if (!filter || it.id.includes(filter)) rows.push(await measureItem(it));
      for (const [id, err] of fragmentSpread(rows)) rows.find((r) => r.id === id)?.errors.push(err);
      return rows;
    },
    async wav(id) {
      const r = await renderItem(find(id));
      return toBase64(encodeWav(r.post, r.sampleRate));
    },
    async exportWav(id) {
      const r = await renderItem(find(id));
      const blob = new Blob([encodeWav(r.post, r.sampleRate)], { type: 'audio/wav' });
      const a = el('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${id.replace(/[^a-z0-9@-]+/gi, '_')}.wav`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    },
  };
  return lab;
}
