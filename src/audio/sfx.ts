// Звуки действий. Всё синтезируется на лету; громкости — доли шины звуков (0..1), здесь, а не в балансе.
// При prefers-reduced-motion громкие удары (обвал, падение яруса, финал) звучат мягче, но не пропадают.
import { type AudioEngine, midiToHz } from './audio';
import { bell, noise, organ, tone } from './synth';

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
  | 'page'
  | 'final'
  | 'decree';

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Сыграть звук через `delay` секунд. До разблокировки контекста — молча. */
export function playSfx(e: AudioEngine, name: SfxName, delay = 0): void {
  const ctx = e.ctx;
  if (!ctx || !e.ready || !e.sfxAudible) return;
  const t = ctx.currentTime + 0.01 + delay;
  const out = e.sfxBus;
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
  tab(e, t, out) {
    noise(e, { t, dur: 0.004, release: 0.025, gain: 0.22, dest: out, filter: 'bandpass', freq: 2400, q: 3 });
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
    tone(e, { freq: 140, to: 55, t, dur: 0.03, release: 0.18, gain: 0.5 * soft, dest: out });
    noise(e, {
      t,
      dur: 0.02,
      release: 0.09,
      gain: 0.32 * soft,
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
  // Сброс яруса: свист падения и глухой удар далеко внизу
  tierDrop(e, t, out, soft) {
    tone(e, {
      freq: 1100,
      to: 140,
      t,
      dur: 1.1,
      attack: 0.05,
      release: 0.15,
      gain: 0.07 * soft,
      dest: out,
      vibrato: [30, 7],
    });
    noise(e, {
      t,
      dur: 1.1,
      attack: 0.3,
      release: 0.1,
      gain: 0.08 * soft,
      dest: out,
      filter: 'bandpass',
      freq: 2500,
      to: 400,
      q: 2,
    });
    const hit = t + 1.25;
    tone(e, { freq: 70, to: 32, t: hit, dur: 0.05, release: 1.2, gain: 0.55 * soft, dest: out, send: 0.4 });
    noise(e, {
      t: hit,
      dur: 0.15,
      release: 1.1,
      gain: 0.35 * soft,
      dest: out,
      filter: 'lowpass',
      freq: 600,
      to: 120,
      send: 0.5,
    });
  },
  // «Завершить день»: два удара вечернего колокола
  endDay(e, t, out, soft) {
    bell(e, midiToHz(45), t, 0.1 * soft, out);
    bell(e, midiToHz(45), t + 0.9, 0.07 * soft, out);
  },
  // Ночь: гул поднимающейся Мглы и порыв ветра
  night(e, t, out, soft) {
    tone(e, {
      type: 'sawtooth',
      freq: 41,
      t,
      dur: 1.6,
      attack: 0.9,
      release: 1.4,
      gain: 0.12 * soft,
      filter: 140,
      dest: out,
      detune: 9,
    });
    tone(e, { freq: 55, t, dur: 1.6, attack: 0.9, release: 1.4, gain: 0.18 * soft, dest: out });
    noise(e, {
      t,
      dur: 1.4,
      attack: 0.8,
      release: 1.2,
      gain: 0.14,
      dest: out,
      filter: 'bandpass',
      freq: 380,
      to: 900,
      q: 3,
      send: 0.3,
    });
    noise(e, {
      t: t + 0.6,
      dur: 1.0,
      attack: 0.5,
      release: 1.0,
      gain: 0.08,
      dest: out,
      filter: 'bandpass',
      freq: 1400,
      to: 600,
      q: 5,
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
    tone(e, { freq: 49, to: 40, t, dur: 0.05, release: 1.6, gain: 0.35 * soft, dest: out, send: 0.5 });
    for (const m of [48, 55, 60, 63, 67]) organ(e, midiToHz(m), t + 0.3, 2.2, 0.04, out, 0.7);
  },
  // Декрет: удар штампа потяжелее и подпись пером
  decree(e, t, out, soft) {
    SOUNDS.choice(e, t, out, soft);
    noise(e, {
      t: t + 0.18,
      dur: 0.22,
      attack: 0.02,
      release: 0.06,
      gain: 0.05,
      dest: out,
      filter: 'bandpass',
      freq: 5200,
      to: 3000,
      q: 2,
    });
  },
};
