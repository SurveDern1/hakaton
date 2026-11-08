// Звуковая лаборатория `?sound=lab`: все звуки, файлы с заменой, темы и фоны кнопками, ползунки
// состояния (режим двигателя, эфир, зазор до Мглы, фаза, высота — их слушает фон через lab.onState),
// приглушение музыки и атмосферы, индикаторы пика и громкости по AnalyserNode на выходе.
// Без колонок и без жеста: sedmaya.sound.lab.measure() — рендер каждого звука на
// AudioEngine.offline и таблица метрик (metrics.ts); lab.wav(id) — WAV в base64, lab.exportWav(id) —
// скачать. Этим пользуется `npm run check:sound` (tools/check-sound.mjs).
import { AudioEngine, type DuckBus, type NoiseColor } from './audio';
import './lab.css';
import { checkMetrics, encodeWav, measureChannels, type SoundMetrics } from './metrics';
import { type Music, scheduleTheme, THEMES, type ThemeName } from './music';
import { playSample, SAMPLE_NAMES, type SampleName } from './samples';
import { playSfx, SFX_NAMES } from './sfx';
import { noise } from './synth';

type Group = 'sfx' | 'sample' | 'theme' | 'amb';

export interface LabItem {
  id: string;
  group: Group;
  /** oneshot — проверяются края и хвост; loop — тема или фон, обрезанные посреди звучания. */
  kind: 'oneshot' | 'loop';
  /** Длина рендера, с. */
  seconds: number;
  /** Поставить звук на движок (живой или оффлайновый) с начала. */
  schedule(e: AudioEngine): void;
}

export interface LabRow extends SoundMetrics {
  id: string;
  group: Group;
  kind: 'oneshot' | 'loop';
  errors: string[];
}

/** Состояние для фона: его слушает Ambience (срез 1) через lab.onState. */
export interface LabState {
  mode: 'hold' | 'climb' | 'save';
  /** Запас эфира 0..1. */
  aether: number;
  /** Зазор до Мглы, м. */
  mistGap: number;
  phase: 'day' | 'night' | 'morning';
  /** Высота башни, м. */
  height: number;
}

/** Длина рендера короткого звука: самый долгий (финал) плюс хвост зала 2,6 с. */
const ONESHOT_SECONDS = 9;
const THEME_SECONDS = 16;

/** Фон-заготовка: шум нужного цвета на шине атмосферы — пока нет настоящего фона (срез 1). */
function ambNoise(color: NoiseColor): LabItem {
  return {
    id: `amb:${color}`,
    group: 'amb',
    kind: 'oneshot',
    seconds: 6,
    schedule(e) {
      const freq = color === 'white' ? 6000 : color === 'pink' ? 4000 : 1200;
      const t = (e.ctx?.currentTime ?? 0) + 0.01;
      noise(e, {
        t,
        dur: 3,
        attack: 0.6,
        release: 0.8,
        gain: 0.3,
        dest: e.ambBus,
        filter: 'lowpass',
        freq,
        color,
      });
    },
  };
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
      }),
    ),
    {
      id: 'sfx:build@left',
      group: 'sfx',
      kind: 'oneshot',
      seconds: ONESHOT_SECONDS,
      schedule: (e) => playSfx(e, 'build', 0, { pan: -0.8 }),
    },
    ...SAMPLE_NAMES.map(
      (name): LabItem => ({
        id: `sample:${name}`,
        group: 'sample',
        kind: 'oneshot',
        seconds: ONESHOT_SECONDS,
        schedule: (e) => void playSample(e, name),
      }),
    ),
    ...THEMES.map(
      (name): LabItem => ({
        id: `theme:${name}`,
        group: 'theme',
        kind: 'loop',
        seconds: THEME_SECONDS,
        schedule: (e) => scheduleTheme(e, name, THEME_SECONDS),
      }),
    ),
    ...(['white', 'pink', 'brown'] as NoiseColor[]).map(ambNoise),
  ];
}

/** Отрендерить пункт без колонок. */
export async function renderItem(
  item: LabItem,
): Promise<{ post: Float32Array[]; pre: Float32Array[]; sampleRate: number }> {
  const e = AudioEngine.offline(item.seconds);
  item.schedule(e);
  return e.render();
}

export async function measureItem(item: LabItem): Promise<LabRow> {
  const r = await renderItem(item);
  const m = measureChannels(r.pre, r.post, r.sampleRate);
  return { id: item.id, group: item.group, kind: item.kind, ...m, errors: checkMetrics(m, item.kind) };
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
}

const fmt = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '−∞');

/** Страница лаборатории поверх игры. */
export function mountLab(host: HTMLElement, deps: LabDeps): Lab {
  const { engine, music } = deps;
  const items = labItems();
  const byId = new Map(items.map((i) => [i.id, i]));
  const find = (id: string) => {
    const it = byId.get(id);
    if (!it) throw new Error(`Нет звука ${id}; есть: ${[...byId.keys()].join(', ')}`);
    return it;
  };
  const state: LabState = { mode: 'hold', aether: 0.6, mistGap: 40, phase: 'day', height: 30 };
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
      if (root.isConnected) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // ---- Кнопки звуков ----
  const GROUPS: [Group, string][] = [
    ['sfx', 'Звуки действий'],
    ['sample', 'Файлы (пока нет файла — замена)'],
    ['theme', 'Музыка'],
    ['amb', 'Фоны'],
  ];
  const playLive = async (item: LabItem) => {
    if (!(await live())) return;
    if (item.group === 'theme') {
      const name = item.id.slice('theme:'.length) as ThemeName;
      music.set(music.current === name ? null : name);
      status.textContent = music.current ? `Музыка: ${music.current}` : 'Музыка остановлена';
      return;
    }
    if (item.group === 'sample') {
      const r = playSample(engine, item.id.slice('sample:'.length) as SampleName);
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
  const emit = () => {
    for (const fn of stateListeners) fn({ ...state });
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
  range('height', 'Высота, м', 10, 120, 1);
  stSec.append(grid);
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
