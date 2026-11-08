// Звук и музыка поверх игры без правок в панелях: initAudio подписывается на фазы GameLoop,
// на изменения GameStore (stateCues) и смотрит за слоем #ui (MutationObserver) и кликами.
// Фазы: start/day → мелодия дня из настроек (waltz/march/wind), night/morning → «ночь»
// (утренние окна читаются под ночную тему),
// final → «финал». Звуки: клики по кнопкам, окно события и выбор (класс is-chosen у .ev-layer),
// всплывающие числа .ev-float.up/.down, стенгазета .pp-layer, ночь, утро, финал.
// Выключатель: пункты меню (menuItems: «Звук», «Настройки…»), кнопка в углу на стартовом экране и в финале,
// клавиша M. Окно «Настройки» — settings-window.ts (openSettings). Файлы звуков — samples.ts
// (preloadSamples после разблокировки), лаборатория `?sound=lab` — lab.ts.
// Фон (ambience.ts) живёт с первого жеста: фаза, состояние и открытые окна → soundscape → Ambience.set;
// start — только ветер, day/morning/night — всё, final — затухание за 3 с, ветер остаётся.
// Окно события, стенгазета, комикс и итог приглушают фон через engine.duck('amb').
// События (срез 4 плана звука, events.ts): рычаг двигателя и стройка со стороны слота — по stateCues;
// сброс яруса — playTierDrop в такт падению; листок календаря — в кадр с классом is-turn у .hud-leaf
// (причина calendar/calendarRed из stateCues ждёт его, без HUD — через CAL_WAIT); подъём Мглы — первое
// изменение состояния ночью (commit() в src/ui/night.ts) даёт фону rising на T_RISE; финал — тон по verdict.
// Радио (radio.ts): заставка «Включить радио» (src/ui/radio-splash.ts) → holdStartMusic + radioIntro —
// ветер, через 0,6 с «Всем! Всем! Всем!», надпись .start-call мигает по словам (is-on-air), мелодия дня —
// тихо через 2 с после фразы (план звука, Р5). Окно «Сигнал» (data-event="d06_signal") — радио тише и по
// кругу, музыка −10 дБ. Облачко рации в комиксе (.cx-bubble.kind-radio) — всплеск помех, когда проявляется.
// Кнопка звука в шапке — hudButton() (Р6).

import { gameData } from '../core';
import type { GameLoop, Phase } from '../game/loop';
import type { GameStore } from '../game/store';
import { icon } from '../ui/format';
import { Ambience, playGust } from './ambience';
import { AudioEngine, type AudioSettings } from './audio';
import { type Cue, stateCues } from './cues';
import { playCalendar, playLever, playTierDrop } from './events';
import type { Lab } from './lab';
import { Music } from './music';
import { playRadio, playRadioBurst, type RadioHandle } from './radio';
import { preloadSamples } from './samples';
import { openSettings } from './settings-window';
import { playSfx, type SfxName } from './sfx';
import { type AmbMoment, type AmbUi, endingVerdict, soundInputFromState, soundscape } from './soundscape';
import { vary } from './synth';
import './audio.css';

export interface SoundControls {
  engine: AudioEngine;
  /** Музыка: `music.current` — какая тема звучит (для отладки из консоли). */
  music: Music;
  /** Фон башни: `ambience.targets` — текущие цели, `ambience.readout()` — что звучит. */
  ambience: Ambience;
  play(name: SfxName, delay?: number): void;
  toggle(): void;
  /** Пункты для меню игры: «Звук: вкл/выкл» и «Настройки…»; beforeOpen закрывает меню перед окном. */
  menuItems(beforeOpen?: () => void): HTMLElement[];
  /** Окно «Настройки» поверх игры. */
  openSettings(): void;
  /** Звуковая лаборатория — только на `?sound=lab` (main.ts подключает lab.ts). */
  lab?: Lab;
  /** Заставка «Включить радио» показана: мелодия стартового экрана ждёт конца фразы радио. */
  holdStartMusic(): void;
  /**
   * Радио на стартовом экране после заставки: ветер уже идёт, через 0,6 с «Всем! Всем! Всем!», `call`
   * получает is-on-air на каждое слово. Звука нет — снимает is-waiting, надпись мигает сама (CSS).
   */
  radioIntro(call: HTMLElement): void;
  /** Кнопка звука для шапки игры: динамик / перечёркнутый, aria-pressed. */
  hudButton(): HTMLElement;
}

/** Пауза между всплывающими числами, с: пачка чисел звучит как короткая россыпь, а не аккорд. */
const FLOAT_GAP = 0.07;
const FLOAT_MAX = 5;
/** Подъём Мглы ночью, мс: как T_RISE в src/ui/night.ts (переход сцены на commit()). */
const MIST_RISE_MS = 1300;
/** Сколько ждать класса is-turn у листка, прежде чем сыграть отрыв без него, мс. */
const CAL_WAIT = 700;
/** Радио после появления стартового экрана, с: сначала слышен ветер. */
const INTRO_DELAY = 0.6;
/** Мелодия дня после фразы, мс, и насколько тише обычного, дБ (Р5). */
const INTRO_MUSIC_MS = 2000;
const INTRO_MUSIC_DB = -8;
/** Окно «Сигнал»: радио тише, музыка −10 дБ, фраза повторяется не чаще раза в 8 с. */
const SIGNAL_EVENT = 'd06_signal';
const SIGNAL_GAIN = 0.55;
const SIGNAL_MUSIC_DB = -10;
const SIGNAL_PERIOD = 8;
/** Звук ещё не разблокирован жестом или выключен: проверить снова через, мс. */
const RADIO_RETRY_MS = 1000;

export function initAudio(opts: { root: HTMLElement; store: GameStore; loop: GameLoop }): SoundControls {
  const engine = new AudioEngine();
  engine.unlockOn(window);
  const music = new Music(engine);
  // Файлы звуков грузятся после разблокировки; пока их нет, играет синтезированная замена
  engine.onReady(() => void preloadSamples(engine));
  const play = (name: SfxName, delay = 0) => playSfx(engine, name, delay);
  const ambience = new Ambience(engine);
  const corner = document.createElement('button');
  corner.type = 'button';
  corner.className = 'snd-toggle';
  corner.addEventListener('click', () => toggle());
  // В рамке телефона #app (style.css), чтобы кнопка была в углу экрана игры, а не окна браузера
  (document.getElementById('app') ?? document.body).append(corner);

  // ---- Фазы цикла: темы и крупные звуки ----
  let phase: Phase = opts.loop.phase;

  // ---- Фон: цели из состояния, фазы и окон; приглушение под окнами ----
  let ui: AmbUi = { event: false, paper: false, comic: false, verdict: false };
  let moment: AmbMoment = {};
  let duckDb = 0;
  let releaseDuck: (() => void) | null = null;
  const refreshAmbience = () => {
    const t = soundscape(soundInputFromState(opts.store.state, gameData.balance), phase, ui, moment);
    ambience.set(t);
    if (t.duckDb !== duckDb) {
      duckDb = t.duckDb;
      releaseDuck?.();
      releaseDuck = duckDb < 0 ? engine.duck('amb', duckDb, 0.3, 1.2) : null;
    }
  };
  engine.onReady(() => {
    ambience.start();
    refreshAmbience();
  });
  let pendingTierUp = false;
  let risen = false;
  let riseTimer = 0;
  // Заставка: мелодия стартового экрана ждёт фразы радио, потом звучит тише (introQuiet)
  let introHold = false;
  let introQuiet: (() => void) | null = null;
  opts.loop.onPhase((next) => {
    const prev = phase;
    phase = next;
    risen = false;
    window.clearTimeout(riseTimer);
    moment = next === 'final' ? { verdict: endingVerdict(opts.store.state, gameData) } : {};
    if (next !== 'start') {
      introHold = false;
      introQuiet?.();
      introQuiet = null;
    }
    if (next === 'night') {
      play('night');
      music.set('night');
    } else if (next === 'morning') {
      music.set('night');
      if (prev !== 'start' || engine.ready) play('morning', 0.4);
      if (pendingTierUp) {
        pendingTierUp = false;
        play('tierUp', 1.6);
      }
    } else if (next === 'day' || next === 'start') {
      music.set(engine.settings.melody);
    } else if (next === 'final') {
      play('final');
      music.set('final');
    }
    refreshAmbience();
    syncCorner();
  });
  // Музыка стартового экрана заиграет сама, как только жест разблокирует звук
  if (!music.current) music.set(engine.settings.melody);
  // Новая мелодия в настройках — сразу, если сейчас её время (день или стартовый экран)
  engine.onSettings((s) => {
    if (introHold) return;
    if ((phase === 'day' || phase === 'start') && music.current !== s.melody) music.set(s.melody);
  });

  // ---- Действия дня по разнице состояний ----
  /** Листок календаря ждёт кадра с анимацией (is-turn): red — красный день. */
  let pendingLeaf: { red: boolean; timer: number } | null = null;
  const playLeaf = () => {
    if (!pendingLeaf) return;
    window.clearTimeout(pendingLeaf.timer);
    playCalendar(engine, pendingLeaf.red);
    pendingLeaf = null;
  };
  const onCue = (cue: Cue) => {
    switch (cue.name) {
      case 'tierUp':
        if (phase === 'night') pendingTierUp = true;
        else play('tierUp');
        return;
      case 'tierDrop':
        return playTierDrop(engine, cue.tier);
      case 'calendar':
      case 'calendarRed':
        if (pendingLeaf) window.clearTimeout(pendingLeaf.timer);
        pendingLeaf = { red: cue.name === 'calendarRed', timer: window.setTimeout(playLeaf, CAL_WAIT) };
        return;
      case 'lever':
        return playLever(engine, cue.dir);
      case 'build':
      case 'demolish':
        return playSfx(engine, cue.name, 0, { pan: cue.pan, gain: vary(engine.rnd, 10) });
      default:
        play(cue.name);
    }
  };
  let last = opts.store.state;
  opts.store.subscribe((s) => {
    const prev = last;
    last = s;
    // Первое изменение ночью — commit() анимации ночи: Мгла поднимается за T_RISE
    if (phase === 'night' && prev !== s && !risen) {
      risen = true;
      moment = { rising: true };
      riseTimer = window.setTimeout(() => {
        moment = {};
        refreshAmbience();
      }, MIST_RISE_MS);
    }
    refreshAmbience();
    if (phase === 'start' || phase === 'final') return;
    for (const cue of stateCues(prev, s, gameData.balance.calendar.days)) onCue(cue);
  });

  // ---- Слой интерфейса: окна, числа, стенгазета ----
  let floatAt = 0;
  let floatsQueued = 0;
  const stamped = new WeakSet<Element>();
  const onAdded = (el: Element) => {
    if (el.classList.contains('ev-float')) {
      const ctx = engine.ctx;
      if (!ctx || floatsQueued >= FLOAT_MAX) return;
      const delay = Math.max(0, floatAt - ctx.currentTime);
      floatAt = ctx.currentTime + delay + FLOAT_GAP;
      floatsQueued += 1;
      window.setTimeout(() => (floatsQueued -= 1), (delay + FLOAT_GAP) * 1000);
      play(el.classList.contains('up') ? 'plus' : 'minus', delay);
    } else if (el.classList.contains('pp-layer')) play('paper');
    else if (el.classList.contains('ev-layer')) play('eventOpen');
    // Карточка обучения (src/tutorial/coach.ts): .tut в слое .tut-layer
    else if (el.classList.contains('tut') && el.parentElement?.classList.contains('tut-layer')) play('hint');
  };
  /** Что открыто поверх башни: окно события или отчёт, стенгазета, комикс, итог или финал. */
  const readUi = (): AmbUi => {
    const r = opts.root;
    return {
      event: !!r.querySelector('.ev-layer:not(.pp-layer):not(.is-leaving)'),
      paper: !!r.querySelector('.pp-layer:not(.is-leaving)'),
      comic: !!r.querySelector('.cx-layer'),
      verdict: !!r.querySelector('.vd, .fin-layer'),
    };
  };
  new MutationObserver((records) => {
    syncSignal(!!opts.root.querySelector(`.ev-layer[data-event="${SIGNAL_EVENT}"]:not(.is-leaving)`));
    const next = readUi();
    if (
      next.event !== ui.event ||
      next.paper !== ui.paper ||
      next.comic !== ui.comic ||
      next.verdict !== ui.verdict
    ) {
      ui = next;
      refreshAmbience();
    }
    for (const r of records) {
      if (r.type === 'childList') {
        for (const n of r.addedNodes) if (n instanceof Element) onAdded(n);
      } else if (r.target instanceof Element) {
        const t = r.target;
        if (t.classList.contains('hud-leaf') && t.classList.contains('is-turn')) playLeaf();
        else if (t.classList.contains('ev-layer') && t.classList.contains('is-chosen') && !stamped.has(t)) {
          stamped.add(t);
          play('choice');
        } else if (t.classList.contains('cx-panel') && t.classList.contains('is-in') && !stamped.has(t)) {
          stamped.add(t);
          radioBubbles(t);
        }
      }
    }
  }).observe(opts.root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

  // Лист комикса (src/comics/viewer.ts)
  opts.root.addEventListener('comic:turn', () => play('page'));

  // ---- Радио ----
  /** Облачко рации проявляется с задержкой --d (viewer.ts) — помехи в тот же миг. Назад листают без звука. */
  function radioBubbles(panel: Element) {
    if (panel.classList.contains('is-instant')) return;
    const reduced = !!panel.closest('.cx-layer.is-reduced');
    for (const b of panel.querySelectorAll<HTMLElement>('.cx-bubble.kind-radio')) {
      const d = reduced ? 0 : Number.parseFloat(b.style.getPropertyValue('--d')) || 0;
      playRadioBurst(engine, d / 1000);
    }
  }

  /** Окно «Сигнал» открыто: фраза по кругу тихо, музыка отходит. */
  let signal: { stop(): void } | null = null;
  function syncSignal(open: boolean) {
    if (open && !signal) signal = signalLoop();
    else if (!open && signal) {
      signal.stop();
      signal = null;
    }
  }
  function signalLoop(): { stop(): void } {
    let alive = true;
    let cur: RadioHandle | null = null;
    let timer = 0;
    const duckOff = engine.duck('music', SIGNAL_MUSIC_DB, 0.4, 1.2);
    const next = () => {
      if (!alive) return;
      cur = playRadio(engine, { gain: SIGNAL_GAIN, delay: 0.3 });
      const wait = cur ? Math.max(SIGNAL_PERIOD, cur.script.length + 1) * 1000 : RADIO_RETRY_MS;
      timer = window.setTimeout(next, wait);
    };
    next();
    return {
      stop() {
        alive = false;
        window.clearTimeout(timer);
        cur?.stop();
        duckOff();
      },
    };
  }

  const holdStartMusic = () => {
    introHold = true;
    music.set(null);
  };
  const releaseStartMusic = () => {
    if (!introHold) return;
    introHold = false;
    if (phase !== 'start') return;
    introQuiet = engine.duck('music', INTRO_MUSIC_DB, 0.05, 3);
    music.set(engine.settings.melody);
  };
  function radioIntro(call: HTMLElement) {
    let begun = false;
    const fallback = () => {
      if (begun) return;
      begun = true;
      call.classList.remove('is-waiting');
      releaseStartMusic();
    };
    // Без Web Audio или если жест так и не запустил звук — надпись мигает сама
    const guard = window.setTimeout(fallback, 1500);
    engine.onReady(() =>
      window.setTimeout(() => {
        if (begun) return;
        window.clearTimeout(guard);
        const radio = phase === 'start' ? playRadio(engine, { duck: true }) : null;
        if (!radio) return fallback();
        begun = true;
        radio.onWord((i) => {
          call.classList.remove('is-on-air');
          void call.offsetWidth;
          call.classList.add('is-on-air');
          call.dataset.word = String(i + 1);
        });
        void radio.done.then(() => {
          call.classList.remove('is-waiting');
          call.classList.add('is-heard');
          window.setTimeout(releaseStartMusic, INTRO_MUSIC_MS);
        });
      }, INTRO_DELAY * 1000),
    );
  }

  // ---- Клики по кнопкам ----
  document.addEventListener(
    'click',
    (ev) => {
      const target =
        ev.target instanceof Element ? ev.target.closest('button, [role="tab"], [role="menuitem"]') : null;
      if (!target || target.closest('.snd-toggle, .snd-hud')) return;
      if (target.getAttribute('aria-disabled') === 'true') return play('denied');
      // У этих звук свой: выбор — печать по is-chosen, стройка и декрет — по состоянию
      if (target.matches('[data-choice], .bm-opt, [data-act="decree"]')) return;
      if (target.matches('.panel-end')) return play('endDay');
      if (target.matches('.tab, [role="tab"]')) return play('tab');
      play('click');
    },
    true,
  );

  const toggle = () => {
    engine.toggleMuted();
    if (!engine.settings.muted) play('click');
  };
  document.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.repeat) return;
    if (ev.target instanceof HTMLElement && ev.target.closest('input, textarea, [contenteditable]')) return;
    if (ev.key === 'm' || ev.key === 'M' || ev.key === 'ь' || ev.key === 'Ь') toggle();
  });

  // ---- Кнопка в углу: стартовый экран и финал, где меню игры нет ----
  function syncCorner() {
    corner.hidden = phase !== 'start' && phase !== 'final';
  }
  const paint = (s: AudioSettings) => {
    corner.setAttribute('aria-pressed', String(!s.muted));
    corner.setAttribute('aria-label', s.muted ? 'Включить звук' : 'Выключить звук');
    corner.title = s.muted ? 'Звук выключен (M)' : 'Звук включён (M)';
    corner.dataset.muted = String(s.muted);
  };
  paint(engine.settings);
  engine.onSettings(paint);
  syncCorner();

  const settings = () =>
    openSettings(opts.root, { engine, preview: () => play('plus'), previewAmbience: () => playGust(engine) });

  function menuItems(beforeOpen?: () => void): HTMLElement[] {
    const item = (text: string) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.className = 'gm-item snd-item';
      b.textContent = text;
      return b;
    };
    const sound = item('');
    const label = () => {
      sound.textContent = `Звук: ${engine.settings.muted ? 'выкл' : 'вкл'}`;
    };
    label();
    sound.addEventListener('click', () => {
      toggle();
      label();
    });
    // подпись обновляется и при переключении клавишей M, пока меню открыто
    const off = engine.onSettings(() => (sound.isConnected ? label() : off()));
    const open = item('Настройки…');
    open.addEventListener('click', () => {
      beforeOpen?.();
      settings();
    });
    return [sound, open];
  }

  function hudButton(): HTMLElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ibtn snd-hud';
    b.addEventListener('click', () => toggle());
    const draw = (s: AudioSettings) => {
      b.innerHTML = icon(s.muted ? 'soundOff' : 'sound', 20);
      b.setAttribute('aria-pressed', String(!s.muted));
      b.setAttribute('aria-label', s.muted ? 'Включить звук' : 'Выключить звук');
      b.title = s.muted ? 'Звук выключен (M)' : 'Звук включён (M)';
      b.dataset.muted = String(s.muted);
    };
    draw(engine.settings);
    engine.onSettings(draw);
    return b;
  }

  return {
    engine,
    music,
    ambience,
    play,
    toggle,
    menuItems,
    openSettings: settings,
    holdStartMusic,
    radioIntro,
    hudButton,
  };
}
