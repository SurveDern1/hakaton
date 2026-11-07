// Звук и музыка поверх игры без правок в панелях: initAudio подписывается на фазы GameLoop,
// на изменения GameStore (stateCues) и смотрит за слоем #ui (MutationObserver) и кликами.
// Фазы: start/day → тема «день», night/morning → «ночь» (утренние окна читаются под ночную тему),
// final → «финал». Звуки: клики по кнопкам, окно события и выбор (класс is-chosen у .ev-layer),
// всплывающие числа .ev-float.up/.down, стенгазета .pp-layer, ночь, утро, финал.
// Выключатель: пункты меню (menuItems), кнопка в углу на стартовом экране и в финале, клавиша M.
import type { GameLoop, Phase } from '../game/loop';
import type { GameStore } from '../game/store';
import { AudioEngine, type AudioSettings } from './audio';
import { stateCues } from './cues';
import { Music } from './music';
import { playSfx, type SfxName } from './sfx';
import './audio.css';

export interface SoundControls {
  engine: AudioEngine;
  play(name: SfxName, delay?: number): void;
  toggle(): void;
  /** Пункты для меню игры: «Звук», «Музыка», «Эффекты»; подписи обновляются сами. */
  menuItems(): HTMLElement[];
}

/** Ступени громкости в меню, по кругу. */
const LEVELS = [0, 0.3, 0.6, 1];
/** Пауза между всплывающими числами, с: пачка чисел звучит как короткая россыпь, а не аккорд. */
const FLOAT_GAP = 0.07;
const FLOAT_MAX = 5;

export function initAudio(opts: { root: HTMLElement; store: GameStore; loop: GameLoop }): SoundControls {
  const engine = new AudioEngine();
  engine.unlockOn(window);
  const music = new Music(engine);
  const play = (name: SfxName, delay = 0) => playSfx(engine, name, delay);
  const corner = document.createElement('button');
  corner.type = 'button';
  corner.className = 'snd-toggle';
  corner.addEventListener('click', () => toggle());
  // В рамке телефона #app (style.css), чтобы кнопка была в углу экрана игры, а не окна браузера
  (document.getElementById('app') ?? document.body).append(corner);

  // ---- Фазы цикла: темы и крупные звуки ----
  let phase: Phase = opts.loop.phase;
  let pendingTierUp = false;
  opts.loop.onPhase((next) => {
    const prev = phase;
    phase = next;
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
      music.set('day');
    } else if (next === 'final') {
      play('final');
      music.set('final');
    }
    syncCorner();
  });
  // Музыка стартового экрана заиграет сама, как только жест разблокирует звук
  if (!music.current) music.set('day');

  // ---- Действия дня по разнице состояний ----
  let last = opts.store.state;
  opts.store.subscribe((s) => {
    const prev = last;
    last = s;
    if (phase === 'start' || phase === 'final') return;
    for (const cue of stateCues(prev, s)) {
      if (cue === 'tierUp' && phase === 'night') pendingTierUp = true;
      else play(cue);
    }
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
  };
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'childList') {
        for (const n of r.addedNodes) if (n instanceof Element) onAdded(n);
      } else if (r.target instanceof Element) {
        const t = r.target;
        if (t.classList.contains('ev-layer') && t.classList.contains('is-chosen') && !stamped.has(t)) {
          stamped.add(t);
          play('choice');
        }
      }
    }
  }).observe(opts.root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

  // ---- Клики по кнопкам ----
  document.addEventListener(
    'click',
    (ev) => {
      const target =
        ev.target instanceof Element ? ev.target.closest('button, [role="tab"], [role="menuitem"]') : null;
      if (!target || target.closest('.snd-toggle')) return;
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

  function menuItems(): HTMLElement[] {
    const item = (label: () => string, onClick: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.className = 'gm-item snd-item';
      const set = () => {
        b.textContent = label();
      };
      set();
      b.addEventListener('click', () => {
        onClick();
        set();
      });
      // подписи обновляются и при переключении клавишей M, пока меню открыто
      const off = engine.onSettings(() => (b.isConnected ? set() : off()));
      return b;
    };
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    const step = (v: number) => LEVELS[(LEVELS.findIndex((l) => l >= v - 0.01) + 1) % LEVELS.length] ?? 0;
    return [
      item(() => `Звук: ${engine.settings.muted ? 'выкл' : 'вкл'}`, toggle),
      item(
        () => `Музыка: ${pct(engine.settings.music)}`,
        () => engine.update({ music: step(engine.settings.music) }),
      ),
      item(
        () => `Эффекты: ${pct(engine.settings.sfx)}`,
        () => {
          engine.update({ sfx: step(engine.settings.sfx) });
          play('plus');
        },
      ),
    ];
  }

  return { engine, play, toggle, menuItems };
}
