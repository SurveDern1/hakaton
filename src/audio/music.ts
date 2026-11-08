// Генеративная музыка: темы — гармонические петли, поверх которых мелодия сочиняется
// заново с сидом. Планировщик смотрит на 0,3 с вперёд и ставит ноты по часам AudioContext.
// Мелодия дня выбирается в «Настройках» (settings.melody):
// waltz — вальс в ля-миноре (3/4): бас и орган на «раз», духовые «ум-па» на «два-три», кларнет сверху.
// march — марш в ми-миноре: бас на «раз» и «три», медь на слабые доли, малый барабан, труба с пунктиром.
// wind  — «Тишина и ветер»: долгий органный бурдон и редкий колокол, без мелодии; ветер — у фона.
// night — ночь и утренние окна: ре-минор, медленный орган, бас, редкий колокол, тише.
// Шум ветра и гул Мглы играет фон (ambience.ts), а не темы: иначе они задваиваются.
// final — гимн-марш в до-миноре: медные аккорды, литавры, в конце петли мажорный аккорд.
// Смена темы — кроссфейд CROSSFADE секунд; под всеми темами тихий ламповый шум и потрескивание.
import { type AudioEngine, makeRandom, midiToHz, ramp } from './audio';
import { bell, noise, organ, tone } from './synth';

export type ThemeName = 'waltz' | 'march' | 'wind' | 'night' | 'final';

const CROSSFADE = 1.6;
const LOOKAHEAD = 0.3;
const TICK_MS = 60;
/** Уровень лампового шума под музыкой (доля шины музыки). */
const HISS_LEVEL = 0.012;

interface Chord {
  bass: number;
  notes: number[];
}

interface Beat {
  e: AudioEngine;
  t: number;
  /** Длительность доли, с. */
  spb: number;
  beat: number;
  bar: number;
  chord: Chord;
  next: Chord;
  out: AudioNode;
  rnd: () => number;
}

interface Theme {
  bpm: number;
  beats: number;
  gain: number;
  bars: Chord[];
  play(b: Beat): void;
}

const c = (bass: number, ...notes: number[]): Chord => ({ bass, notes });
const pick = <T>(rnd: () => number, list: T[]): T => list[Math.floor(rnd() * list.length)] as T;

/** Голос мелодии: духовые с расстройкой, мягкий фильтр и вибрато. */
function lead(b: Beat, midi: number, beats: number, gain: number, bright = 1500) {
  tone(b.e, {
    type: 'sawtooth',
    freq: midiToHz(midi),
    t: b.t,
    dur: b.spb * beats * 0.92,
    attack: 0.07,
    release: 0.25,
    gain,
    filter: bright,
    filterTo: bright * 0.6,
    detune: 6,
    vibrato: [9, 5],
    dest: b.out,
    send: 0.4,
  });
}

/** Ближайший к предыдущему звук аккорда в нужной октаве: мелодия ходит плавно, без скачков. */
function nearest(notes: number[], prev: number, rnd: () => number): number {
  const pool = notes.flatMap((n) => [n + 12, n + 24]).filter((n) => n >= 64 && n <= 81);
  pool.sort((a, z) => Math.abs(a - prev) - Math.abs(z - prev));
  return pool[rnd() < 0.7 ? 0 : Math.min(pool.length - 1, 1 + Math.floor(rnd() * 2))] ?? prev;
}

function makeThemes(): Record<ThemeName, Theme> {
  let dayPrev = 69;
  let finPrev = 72;
  let marchPrev = 71;
  return {
    waltz: {
      bpm: 76,
      beats: 3,
      gain: 0.9,
      // Am Dm E Am | F Dm E7 Am
      bars: [
        c(45, 57, 60, 64),
        c(38, 57, 62, 65),
        c(40, 56, 59, 64),
        c(45, 57, 60, 64),
        c(41, 57, 60, 65),
        c(38, 57, 62, 65),
        c(40, 56, 59, 62),
        c(45, 57, 60, 64),
      ],
      play(b) {
        const { e, t, spb, chord, out, rnd } = b;
        if (b.beat === 0) {
          organ(e, midiToHz(chord.bass), t, spb * 0.9, 0.07, out, 0.25);
          for (const n of chord.notes) organ(e, midiToHz(n), t, spb * 2.7, 0.012, out, 0.5);
        } else {
          // «па» на второй и третьей доле: короткий приглушённый аккорд медных
          for (const n of chord.notes)
            tone(e, {
              type: 'sawtooth',
              freq: midiToHz(n),
              t,
              dur: spb * 0.28,
              attack: 0.02,
              release: 0.12,
              gain: 0.014,
              filter: 900,
              dest: out,
              send: 0.2,
            });
          if (b.beat === 2 && rnd() < 0.3) organ(e, midiToHz(chord.bass + 7), t, spb * 0.5, 0.03, out, 0.2);
        }
        // Мелодия: каждые 16 тактов — 8 с мелодией, 8 только аккомпанемент (дыхание)
        if (b.bar % 16 >= 8 && b.bar % 16 < 14) return;
        if (b.beat === 0) {
          const r = rnd();
          dayPrev = nearest(chord.notes, dayPrev, rnd);
          if (r < 0.45) lead(b, dayPrev, 2.6, 0.04);
          else if (r < 0.85) lead(b, dayPrev, 1.8, 0.04);
          else lead(b, dayPrev, 0.9, 0.035);
        } else if (b.beat === 2 && rnd() < 0.55) {
          // затакт к следующему аккорду
          dayPrev = nearest(b.next.notes, dayPrev + (rnd() < 0.5 ? 2 : -2), rnd);
          lead(b, dayPrev, 0.9, 0.032);
        }
      },
    },
    march: {
      bpm: 100,
      beats: 4,
      gain: 0.85,
      // Em Am B7 Em | C Am B7 Em
      bars: [
        c(40, 55, 59, 64),
        c(45, 57, 60, 64),
        c(47, 54, 57, 59, 63),
        c(40, 55, 59, 64),
        c(48, 55, 60, 64),
        c(45, 57, 60, 64),
        c(47, 54, 57, 59, 63),
        c(40, 55, 59, 64),
      ],
      play(b) {
        const { e, t, spb, chord, out, rnd } = b;
        if (b.beat === 0 || b.beat === 2) {
          // «раз» и «три»: бас (на «три» — квинта) и большой барабан
          organ(e, midiToHz(chord.bass + (b.beat === 2 ? 7 : 0)), t, spb * 0.8, 0.07, out, 0.2);
          tone(e, { freq: 62, to: 45, t, dur: 0.02, release: 0.25, gain: 0.16, dest: out });
        } else {
          for (const n of chord.notes)
            tone(e, {
              type: 'sawtooth',
              freq: midiToHz(n),
              t,
              dur: spb * 0.3,
              attack: 0.015,
              release: 0.1,
              gain: 0.012,
              filter: 1000,
              dest: out,
              send: 0.2,
            });
          noise(e, {
            t,
            dur: 0.02,
            release: 0.08,
            gain: 0.05,
            dest: out,
            filter: 'bandpass',
            freq: 2800,
            q: 1,
          });
        }
        if (b.bar % 16 >= 8 && b.bar % 16 < 12) return;
        if (b.beat === 0 || b.beat === 2) {
          // пунктир: долгая нота на полторы доли и короткая перед следующей
          marchPrev = nearest(chord.notes, marchPrev, rnd);
          if (rnd() < 0.6) {
            lead(b, marchPrev, 1.4, 0.036, 1900);
            const step = nearest(
              b.beat === 2 ? b.next.notes : chord.notes,
              marchPrev + (rnd() < 0.5 ? 2 : -1),
              rnd,
            );
            lead({ ...b, t: t + spb * 1.5 }, step, 0.45, 0.03, 1900);
            marchPrev = step;
          } else lead(b, marchPrev, 1.9, 0.036, 1900);
        }
      },
    },
    wind: {
      bpm: 40,
      beats: 4,
      gain: 0.8,
      // Am F Am Em — по два такта
      bars: [
        c(45, 57, 60, 64),
        c(45, 57, 60, 64),
        c(41, 57, 60, 65),
        c(41, 57, 60, 65),
        c(45, 57, 60, 64),
        c(45, 57, 60, 64),
        c(40, 55, 59, 64),
        c(40, 55, 59, 64),
      ],
      play(b) {
        const { e, t, spb, chord, out, rnd } = b;
        if (b.beat === 0) {
          if (b.bar % 2 === 0) {
            for (const n of chord.notes) organ(e, midiToHz(n), t, spb * 7.6, 0.008, out, 0.8);
            organ(e, midiToHz(chord.bass - 12), t, spb * 7.6, 0.03, out, 0.4);
          }
          // порывы ветра играет фон; два вызова генератора остаются, чтобы колокол звучал как прежде
          rnd();
          rnd();
        }
        if (b.beat === 2 && rnd() < 0.22) bell(e, midiToHz(pick(rnd, chord.notes) + 24), t, 0.016, out, 0.9);
      },
    },
    night: {
      bpm: 46,
      beats: 4,
      gain: 0.75,
      // Dm Dm Bb Bb | Gm Gm A A
      bars: [
        c(38, 50, 53, 57),
        c(38, 50, 53, 57),
        c(34, 50, 53, 58),
        c(34, 50, 53, 58),
        c(31, 50, 55, 58),
        c(31, 50, 55, 58),
        c(33, 49, 52, 57),
        c(33, 49, 52, 57),
      ],
      play(b) {
        const { e, t, spb, chord, out, rnd } = b;
        if (b.beat === 0) {
          if (b.bar % 2 === 0) {
            for (const n of chord.notes) organ(e, midiToHz(n), t, spb * 7.6, 0.011, out, 0.7);
            tone(e, {
              type: 'sawtooth',
              freq: midiToHz(chord.bass),
              t,
              dur: spb * 7.5,
              attack: 1.2,
              release: 1.5,
              gain: 0.05,
              filter: 220,
              detune: 8,
              dest: out,
            });
          }
          // гул Мглы и ветер играет фон; генератор сдвигается как прежде — фразы и колокол те же
          rnd();
          rnd();
        }
        if (b.beat === 2 && rnd() < 0.28) {
          bell(e, midiToHz(pick(rnd, chord.notes) + 24), t, 0.018, out, 0.9);
        }
        if (b.beat === 1 && b.bar % 4 === 1 && rnd() < 0.6) {
          // одинокая фраза: две ноты вниз, как вздох
          const top = pick(rnd, chord.notes) + 12;
          lead({ ...b }, top, 1.6, 0.026, 900);
          lead({ ...b, t: t + spb * 1.8 }, top - (rnd() < 0.5 ? 1 : 2), 1.8, 0.022, 800);
        }
      },
    },
    final: {
      bpm: 58,
      beats: 4,
      gain: 0.9,
      // Cm Ab Eb Bb | Fm Cm G C (мажор в конце — свет после всего)
      bars: [
        c(36, 55, 60, 63),
        c(32, 56, 60, 63),
        c(39, 55, 58, 63),
        c(34, 53, 58, 62),
        c(41, 56, 60, 65),
        c(36, 55, 60, 63),
        c(43, 55, 59, 62),
        c(36, 55, 60, 64),
      ],
      play(b) {
        const { e, t, spb, chord, out, rnd } = b;
        if (b.beat === 0 || b.beat === 2) {
          for (const n of chord.notes)
            tone(e, {
              type: 'sawtooth',
              freq: midiToHz(n),
              t,
              dur: spb * 1.85,
              attack: 0.08,
              release: 0.4,
              gain: 0.018,
              filter: 700,
              filterTo: 1400,
              detune: 7,
              dest: out,
              send: 0.45,
            });
          organ(e, midiToHz(chord.bass), t, spb * 1.8, 0.05, out, 0.3);
        }
        if (b.beat === 0) {
          // литавры
          tone(e, {
            freq: midiToHz(chord.bass + 12),
            to: midiToHz(chord.bass + 11),
            t,
            dur: 0.02,
            release: 0.9,
            gain: 0.22,
            dest: out,
            send: 0.3,
          });
          noise(e, { t, dur: 0.02, release: 0.3, gain: 0.06, dest: out, filter: 'lowpass', freq: 500 });
        }
        if (b.beat === 3 && b.bar % 2 === 1) {
          // дробь малого барабана щётками перед новым тактом
          for (let i = 0; i < 4; i++)
            noise(e, {
              t: t + i * spb * 0.22,
              dur: 0.01,
              release: 0.06,
              gain: 0.025 + i * 0.008,
              dest: out,
              filter: 'bandpass',
              freq: 3500,
              q: 1.2,
            });
        }
        if (b.bar % 16 >= 8 && b.bar % 16 < 12) return;
        if (b.beat === 0 || (b.beat === 2 && rnd() < 0.7)) {
          finPrev = nearest(chord.notes, finPrev, rnd);
          lead(b, finPrev, b.beat === 0 ? 1.9 : 1.8, 0.038, 1800);
        }
      },
    },
  };
}

class ThemePlayer {
  readonly gain: GainNode;
  private nextTime: number;
  private beat = 0;
  private bar = 0;
  private stopped = false;
  private rnd: () => number;

  constructor(
    private e: AudioEngine,
    readonly name: ThemeName,
    private theme: Theme,
    seed: number,
  ) {
    const ctx = e.ctx as BaseAudioContext;
    this.rnd = makeRandom(seed);
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(e.musicBus);
    ramp(this.gain.gain, theme.gain, ctx.currentTime, CROSSFADE);
    this.nextTime = ctx.currentTime + 0.1;
  }

  fadeOut(): void {
    const ctx = this.e.ctx as BaseAudioContext;
    ramp(this.gain.gain, 0, ctx.currentTime, CROSSFADE);
    this.stopped = true;
    window.setTimeout(() => this.gain.disconnect(), (CROSSFADE + 3) * 1000);
  }

  schedule(now: number): void {
    if (this.stopped) return;
    const spb = 60 / this.theme.bpm;
    // после паузы вкладки или долгого затыка не догоняем пропущенное
    if (this.nextTime < now - 0.5) this.nextTime = now + 0.05;
    while (this.nextTime < now + LOOKAHEAD) {
      const bars = this.theme.bars;
      const chord = bars[this.bar % bars.length] as Chord;
      const next = bars[(this.bar + 1) % bars.length] as Chord;
      if (this.e.musicAudible) {
        this.theme.play({
          e: this.e,
          t: this.nextTime,
          spb,
          beat: this.beat,
          bar: this.bar,
          chord,
          next,
          out: this.gain,
          rnd: this.rnd,
        });
      }
      this.nextTime += spb;
      this.beat += 1;
      if (this.beat >= this.theme.beats) {
        this.beat = 0;
        this.bar += 1;
      }
    }
  }
}

export class Music {
  private themes = makeThemes();
  private players: ThemePlayer[] = [];
  private wanted: ThemeName | null = null;
  private timer = 0;
  private seed = 7;
  private hissOn = false;
  private crackle = makeRandom(1967);

  constructor(private e: AudioEngine) {
    e.onReady(() => this.start());
  }

  /** Сменить тему с кроссфейдом; null — тишина. До разблокировки только запоминает выбор. */
  set(name: ThemeName | null): void {
    this.wanted = name;
    if (this.e.ready) this.apply();
  }

  get current(): ThemeName | null {
    return this.wanted;
  }

  private start(): void {
    this.startHiss();
    this.apply();
    if (!this.timer) this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  private apply(): void {
    const live = this.players.find((p) => p.name === this.wanted);
    for (const p of this.players) if (p !== live) p.fadeOut();
    this.players = live ? [live] : [];
    if (!live && this.wanted) {
      this.seed += 1;
      this.players.push(new ThemePlayer(this.e, this.wanted, this.themes[this.wanted], this.seed * 7919));
    }
  }

  private tick(): void {
    const ctx = this.e.ctx;
    if (!ctx) return;
    if (ctx.state !== 'running') return;
    for (const p of this.players) p.schedule(ctx.currentTime);
    // потрескивание старой пластинки: редкие щелчки
    if (this.wanted && this.e.musicAudible && this.crackle() < 0.04) {
      noise(this.e, {
        t: ctx.currentTime + 0.05,
        dur: 0.002,
        release: 0.01,
        gain: 0.02,
        dest: this.e.musicBus,
        filter: 'highpass',
        freq: 3000,
      });
    }
  }

  /** Ламповый шум: постоянная тихая полоса шума на шине музыки. */
  private startHiss(): void {
    const ctx = this.e.ctx;
    const buf = this.e.noiseBuffer();
    if (!ctx || !buf || this.hissOn) return;
    this.hissOn = true;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 3800;
    f.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.value = HISS_LEVEL;
    src.connect(f).connect(g).connect(this.e.musicBus);
    src.start();
  }
}

/**
 * Тема без колонок (лаборатория, `npm run check:sound`): все ноты на `seconds` ставятся сразу, как это
 * делал бы планировщик по часам. Вход — `AudioEngine.offline(...)`.
 */
export function scheduleTheme(e: AudioEngine, name: ThemeName, seconds: number, seed = 7919): void {
  const player = new ThemePlayer(e, name, makeThemes()[name], seed);
  for (let t = 0; t < seconds; t += LOOKAHEAD / 2) player.schedule(t);
}

export const THEMES: ThemeName[] = ['waltz', 'march', 'wind', 'night', 'final'];
