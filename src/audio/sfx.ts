// Звуки действий. Всё синтезируется на лету; громкости — доли шины звуков (0..1), здесь, а не в балансе.
// При prefers-reduced-motion громкие удары (обвал, падение яруса, финал) звучат мягче, но не пропадают.
import { type AudioEngine, midiToHz } from './audio';
import { dbGain, SFX_TRIM_DB } from './mix';
import { bell, noise, organ, panTo, thump, tone } from './synth';

export type SfxName =
  | 'click'
  | 'tab'
  | 'denied'
  | 'eventOpen'
  | 'choice'
  | 'build'
  | 'demolish'
  | 'tierStart'
  | 'tierUp'
  | 'tierDrop'
  | 'endDay'
  | 'night'
  | 'morning'
  | 'plus'
  | 'minus'
  | 'paper'
  | 'hint'
  | 'page'
  | 'final'
  | 'decree'
  | 'lever'
  | 'calendarRed';

/**
 * Сброс яруса по времени, с от начала падения (FALL_MS = 1100 мс в src/scenes/tower-dom.ts; тест
 * сверяет): стон металла — сразу, обрыв тросов, свист падения до конца падения, облегчённый скрип и
 * взвыв двигателя, глухой удар далеко в Мгле — чуть позже конца падения (звук идёт снизу).
 */
export const DROP = { fall: 1.1, snap: 0.25, whistle: 0.3, relief: 1.3, thud: 1.6 } as const;

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export interface SfxOpts {
  /** Панорама −1 (слева) … 1 (справа): стройка звучит с той стороны башни, где слот. */
  pan?: number;
  /** Множитель громкости этого раза (вариация повторов, тише или громче по месту). */
  gain?: number;
  /** Куда играть вместо шины звуков. */
  dest?: AudioNode;
}

/** Сыграть звук через `delay` секунд. До разблокировки контекста — молча. */
export function playSfx(e: AudioEngine, name: SfxName, delay = 0, opts: SfxOpts = {}): void {
  const ctx = e.ctx;
  if (!ctx || !e.ready || !e.sfxAudible) return;
  const t = ctx.currentTime + 0.01 + delay;
  let out: AudioNode = opts.dest ?? e.sfxBus;
  // громкость этого раза × поправка сведения (mix.ts)
  const level = (opts.gain ?? 1) * dbGain(SFX_TRIM_DB[name] ?? 0);
  if (opts.pan || level !== 1) {
    const g = ctx.createGain();
    g.gain.value = Math.max(0, level);
    g.connect(panTo(ctx, out, opts.pan, t, true));
    out = g;
  }
  const soft = reduced() ? 0.6 : 1;
  e.played.push([name, Math.round(t * 100) / 100]);
  if (e.played.length > 40) e.played.shift();
  SOUNDS[name](e, t, out, soft);
}

type Sound = (e: AudioEngine, t: number, out: AudioNode, soft: number) => void;

const SOUNDS: Record<SfxName, Sound> = {
  // Щелчок тумблера: короткий щелчок шума и тихая «пружина»
  click(e, t, out) {
    noise(e, { t, dur: 0.006, release: 0.03, gain: 0.35, dest: out, filter: 'bandpass', freq: 3200, q: 2 });
    tone(e, { freq: 1150, t, dur: 0.005, release: 0.05, gain: 0.08, dest: out });
  },
  // Вкладка: щелчок мягче и ниже кнопки — короткий шорох и глухой «тик»
  tab(e, t, out) {
    noise(e, { t, dur: 0.006, release: 0.04, gain: 0.3, dest: out, filter: 'bandpass', freq: 2000, q: 2.5 });
    tone(e, { freq: 760, t, dur: 0.004, release: 0.05, gain: 0.05, dest: out });
  },
  // Отказ: глухой двойной «бум» вниз
  denied(e, t, out) {
    tone(e, {
      type: 'square',
      freq: 150,
      to: 110,
      t,
      dur: 0.07,
      release: 0.06,
      gain: 0.07,
      filter: 700,
      dest: out,
    });
    tone(e, {
      type: 'square',
      freq: 120,
      to: 90,
      t: t + 0.11,
      dur: 0.08,
      release: 0.08,
      gain: 0.07,
      filter: 600,
      dest: out,
    });
  },
  // Окно события: шелест бумаги и тихий аккорд органа в миноре
  eventOpen(e, t, out) {
    noise(e, {
      t,
      dur: 0.18,
      attack: 0.04,
      release: 0.2,
      gain: 0.16,
      dest: out,
      filter: 'bandpass',
      freq: 1800,
      to: 4200,
      q: 0.8,
    });
    for (const m of [57, 60, 64]) organ(e, midiToHz(m), t + 0.05, 0.5, 0.035, out, 0.5);
  },
  // Выбор: удар печати по бумаге
  choice(e, t, out, soft) {
    // низ — для наушников; на нём держится пик, поэтому тише тела 280 Гц (слышно и на телефоне)
    tone(e, { freq: 140, to: 55, t, dur: 0.03, release: 0.18, gain: 0.28 * soft, dest: out });
    thump(e, t, out, 0.42 * soft, 280, 0.24);
    noise(e, {
      t,
      dur: 0.02,
      release: 0.09,
      gain: 0.2 * soft,
      dest: out,
      filter: 'lowpass',
      freq: 2200,
      send: 0.15,
    });
    noise(e, {
      t: t + 0.03,
      dur: 0.05,
      release: 0.08,
      gain: 0.06,
      dest: out,
      filter: 'highpass',
      freq: 5000,
    });
  },
  // Стройка: три удара молотка по дереву и звон гвоздя
  build(e, t, out) {
    for (let i = 0; i < 3; i++) {
      const at = t + i * 0.13;
      tone(e, {
        freq: 230 - i * 15,
        to: 160,
        t: at,
        dur: 0.01,
        release: 0.09,
        gain: 0.32,
        dest: out,
        send: 0.12,
      });
      noise(e, {
        t: at,
        dur: 0.01,
        release: 0.05,
        gain: 0.25,
        dest: out,
        filter: 'bandpass',
        freq: 900,
        q: 1.5,
      });
    }
    tone(e, { freq: 2350, t: t + 0.42, dur: 0.01, release: 0.4, gain: 0.05, dest: out, send: 0.3 });
  },
  // Снос: скрежет и осыпающиеся обломки
  demolish(e, t, out, soft) {
    tone(e, {
      type: 'sawtooth',
      freq: 95,
      to: 60,
      t,
      dur: 0.3,
      attack: 0.02,
      release: 0.3,
      gain: 0.12 * soft,
      filter: 500,
      dest: out,
    });
    noise(e, {
      t,
      dur: 0.5,
      attack: 0.03,
      release: 0.4,
      gain: 0.3 * soft,
      dest: out,
      filter: 'lowpass',
      freq: 1400,
      to: 300,
      send: 0.2,
    });
    for (let i = 0; i < 5; i++) {
      noise(e, {
        t: t + 0.25 + i * 0.09 + (i % 2) * 0.03,
        dur: 0.01,
        release: 0.05,
        gain: 0.12,
        dest: out,
        filter: 'bandpass',
        freq: 1200 + i * 300,
        q: 3,
      });
    }
  },
  // Закладка яруса: лязг металла и короткий сигнал
  tierStart(e, t, out) {
    for (const [mul, amp] of [
      [1, 1],
      [2.76, 0.5],
      [5.4, 0.25],
    ] as const) {
      tone(e, { freq: 420 * mul, t, dur: 0.01, release: 0.5, gain: 0.07 * amp, dest: out, send: 0.4 });
    }
    noise(e, { t, dur: 0.02, release: 0.12, gain: 0.18, dest: out, filter: 'highpass', freq: 2500 });
    SOUNDS.build(e, t + 0.25, out, 1);
  },
  // Ярус готов: фанфара медных вверх по ля-минору к мажорной вершине
  tierUp(e, t, out, soft) {
    const notes = [57, 60, 64, 69];
    notes.forEach((m, i) => {
      const last = i === notes.length - 1;
      tone(e, {
        type: 'sawtooth',
        freq: midiToHz(m),
        t: t + i * 0.16,
        dur: last ? 0.7 : 0.13,
        attack: 0.03,
        release: last ? 0.5 : 0.08,
        gain: 0.09 * soft,
        filter: 900,
        filterTo: 2600,
        detune: 7,
        vibrato: last ? [12, 5.5] : undefined,
        dest: out,
        send: 0.35,
      });
    });
    bell(e, midiToHz(69), t + 0.48, 0.05 * soft, out);
  },
  // Сброс яруса (синтез, по DROP): обрыв двух тросов, свист падения уходит вниз и глохнет, взвыв
  // двигателя и глухой удар через Мглу — тело 120–300 Гц слышно на телефоне, низ — в наушниках.
  // Стон металла и облегчённый скрип из файлов добавляет events.ts (playTierDrop).
  tierDrop(e, t, out, soft) {
    for (const [dt, f] of [
      [DROP.snap, 1650],
      [DROP.snap + 0.07, 1320],
    ] as const) {
      noise(e, {
        t: t + dt,
        dur: 0.006,
        release: 0.04,
        gain: 0.3 * soft,
        dest: out,
        filter: 'highpass',
        freq: 2200,
      });
      for (const [mul, amp] of [
        [1, 1],
        [2.3, 0.45],
      ] as const)
        tone(e, {
          freq: f * mul,
          to: f * mul * 0.94,
          t: t + dt,
          dur: 0.005,
          release: 0.35,
          gain: 0.05 * amp * soft,
          dest: out,
          send: 0.35,
        });
    }
    const w = t + DROP.whistle;
    const len = DROP.fall - DROP.whistle;
    tone(e, {
      freq: 1100,
      to: 180,
      t: w,
      dur: len,
      attack: 0.06,
      release: 0.12,
      gain: 0.07 * soft,
      filter: 4000,
      filterTo: 600,
      dest: out,
      vibrato: [30, 7],
    });
    noise(e, {
      t: w,
      dur: len,
      attack: 0.2,
      release: 0.12,
      gain: 0.08 * soft,
      dest: out,
      filter: 'bandpass',
      freq: 2500,
      to: 400,
      q: 2,
    });
    // Двигатель на миг взвывает, когда башня стала легче
    tone(e, {
      type: 'sawtooth',
      freq: 55,
      to: 92,
      t: t + DROP.relief,
      dur: 0.35,
      attack: 0.08,
      release: 0.5,
      gain: 0.05 * soft,
      filter: 700,
      filterTo: 1400,
      dest: out,
      detune: 9,
    });
    const hit = t + DROP.thud;
    tone(e, { freq: 70, to: 32, t: hit, dur: 0.05, release: 1.2, gain: 0.4 * soft, dest: out, send: 0.4 });
    thump(e, hit, out, 0.5 * soft, 220, 0.5);
    noise(e, {
      t: hit,
      dur: 0.15,
      release: 1.1,
      gain: 0.3 * soft,
      dest: out,
      filter: 'lowpass',
      freq: 900,
      to: 150,
      send: 0.5,
    });
  },
  // «Завершить день»: два удара вечернего колокола
  endDay(e, t, out, soft) {
    bell(e, midiToHz(45), t, 0.1 * soft, out);
    bell(e, midiToHz(45), t + 0.9, 0.07 * soft, out);
  },
  // Сумерки: короткий «вздох» — низкий тон уходит вниз под мягкий выдох воздуха. Гул Мглы и ветер
  // ночью играет фон (ambience.ts), здесь только знак, что день кончился.
  night(e, t, out, soft) {
    tone(e, {
      type: 'triangle',
      freq: 110,
      to: 82,
      t,
      dur: 0.5,
      attack: 0.25,
      release: 0.7,
      gain: 0.1 * soft,
      filter: 600,
      dest: out,
      detune: 7,
      send: 0.3,
    });
    noise(e, {
      t,
      dur: 0.45,
      attack: 0.3,
      release: 0.6,
      gain: 0.07,
      dest: out,
      filter: 'bandpass',
      freq: 700,
      to: 380,
      q: 1.5,
      color: 'pink',
      send: 0.25,
    });
  },
  // Утро: побудка горна, мажорная в отличие от тревожной музыки
  morning(e, t, out) {
    const call: [number, number][] = [
      [60, 0.14],
      [65, 0.14],
      [69, 0.28],
      [65, 0.14],
      [72, 0.5],
    ];
    let at = t;
    for (const [m, d] of call) {
      tone(e, {
        type: 'triangle',
        freq: midiToHz(m),
        t: at,
        dur: d * 0.85,
        attack: 0.02,
        release: 0.08,
        gain: 0.1,
        dest: out,
        send: 0.45,
      });
      tone(e, {
        type: 'sawtooth',
        freq: midiToHz(m),
        t: at,
        dur: d * 0.85,
        attack: 0.03,
        release: 0.08,
        gain: 0.025,
        filter: 1800,
        dest: out,
      });
      at += d;
    }
  },
  // Число растёт: короткий щипок вверх
  plus(e, t, out) {
    tone(e, { type: 'triangle', freq: midiToHz(76), t, dur: 0.04, release: 0.14, gain: 0.09, dest: out });
    tone(e, {
      type: 'triangle',
      freq: midiToHz(81),
      t: t + 0.06,
      dur: 0.05,
      release: 0.2,
      gain: 0.08,
      dest: out,
      send: 0.2,
    });
  },
  // Число падает: ниже и глуше, вниз
  minus(e, t, out) {
    tone(e, {
      type: 'triangle',
      freq: midiToHz(64),
      t,
      dur: 0.05,
      release: 0.14,
      gain: 0.09,
      filter: 1600,
      dest: out,
    });
    tone(e, {
      type: 'triangle',
      freq: midiToHz(59),
      t: t + 0.08,
      dur: 0.07,
      release: 0.22,
      gain: 0.08,
      filter: 1200,
      dest: out,
    });
  },
  // Стенгазета: разворот большого листа и пара ударов кнопок
  // Лист комикса: шорох бумаги снизу вверх и мягкий хлопок, когда лист ложится
  page(e, t, out) {
    noise(e, {
      t,
      dur: 0.26,
      attack: 0.06,
      release: 0.16,
      gain: 0.16,
      dest: out,
      filter: 'bandpass',
      freq: 900,
      to: 3600,
      q: 0.8,
    });
    noise(e, {
      t: t + 0.3,
      dur: 0.04,
      attack: 0.005,
      release: 0.12,
      gain: 0.12,
      dest: out,
      filter: 'lowpass',
      freq: 700,
      q: 0.7,
    });
  },
  // Подсказка обучения: короткий шелест карточки и тихий колокольчик — тише стенгазеты
  hint(e, t, out, soft) {
    noise(e, {
      t,
      dur: 0.08,
      attack: 0.02,
      release: 0.1,
      gain: 0.08,
      dest: out,
      filter: 'bandpass',
      freq: 2200,
      to: 3400,
      q: 0.8,
    });
    bell(e, midiToHz(84), t + 0.06, 0.035 * soft, out, 0.4);
  },
  paper(e, t, out) {
    noise(e, {
      t,
      dur: 0.12,
      attack: 0.03,
      release: 0.12,
      gain: 0.18,
      dest: out,
      filter: 'bandpass',
      freq: 2600,
      to: 1200,
      q: 0.7,
    });
    noise(e, {
      t: t + 0.14,
      dur: 0.2,
      attack: 0.05,
      release: 0.18,
      gain: 0.14,
      dest: out,
      filter: 'bandpass',
      freq: 1500,
      to: 3800,
      q: 0.7,
    });
    for (const dt of [0.42, 0.55]) {
      tone(e, { freq: 520, to: 300, t: t + dt, dur: 0.005, release: 0.05, gain: 0.12, dest: out });
    }
  },
  // Финал: удар колокола и долгий органный аккорд
  final(e, t, out, soft) {
    bell(e, midiToHz(43), t, 0.14 * soft, out, 0.8);
    tone(e, { freq: 49, to: 40, t, dur: 0.05, release: 1.6, gain: 0.25 * soft, dest: out, send: 0.5 });
    thump(e, t, out, 0.22 * soft, 196, 0.6);
    for (const m of [48, 55, 60, 63, 67]) organ(e, midiToHz(m), t + 0.3, 2.2, 0.04, out, 0.7);
  },
  // Декрет: удар штампа потяжелее и подпись пером
  decree(e, t, out, soft) {
    SOUNDS.choice(e, t, out, soft);
    // штамп тяжелее печати: второе тело чуть позже, чтобы пики ударов не складывались
    thump(e, t + 0.012, out, 0.25 * soft, 200, 0.3);
    noise(e, {
      t: t + 0.18,
      dur: 0.22,
      attack: 0.02,
      release: 0.06,
      gain: 0.1,
      dest: out,
      filter: 'bandpass',
      freq: 5200,
      to: 3000,
      q: 2,
    });
  },
  // Рычаг двигателя (замена файла lever.mp3): храповик и тяжёлый металлический «клац»
  lever(e, t, out, soft) {
    for (let i = 0; i < 3; i++)
      noise(e, {
        t: t + i * 0.035,
        dur: 0.004,
        release: 0.02,
        gain: 0.2,
        dest: out,
        filter: 'bandpass',
        freq: 2800 + i * 250,
        q: 4,
      });
    const at = t + 0.13;
    thump(e, at, out, 0.28 * soft, 320);
    for (const [mul, amp] of [
      [1, 1],
      [2.7, 0.4],
    ] as const)
      tone(e, { freq: 610 * mul, t: at, dur: 0.005, release: 0.22, gain: 0.04 * amp, dest: out, send: 0.2 });
  },
  // Красный день 7 ноября: после отрыва листка — короткий отзвук медных и колокол
  calendarRed(e, t, out, soft) {
    const notes: [number, number, number][] = [
      [67, 0, 0.14],
      [72, 0.16, 0.55],
    ];
    for (const [m, dt, d] of notes)
      for (const detune of [-6, 6])
        tone(e, {
          type: 'sawtooth',
          freq: midiToHz(m),
          t: t + dt,
          dur: d,
          attack: 0.03,
          release: 0.35,
          gain: 0.045 * soft,
          filter: 1000,
          filterTo: 2600,
          detune,
          dest: out,
          send: 0.4,
        });
    bell(e, midiToHz(84), t + 0.18, 0.05 * soft, out, 0.6);
  },
};

/** Все звуки по порядку объявления — для лаборатории и проверки `check:sound`. */
export const SFX_NAMES = Object.keys(SOUNDS) as SfxName[];
