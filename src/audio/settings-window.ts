// Окно «Настройки»: «Без звука», общая громкость, музыка, атмосфера (ветер, двигатель, Мгла) и звуки
// (ползунок + выключатель), мелодия дня.
// Открывается из меню игры и со стартового экрана (initAudio → openSettings). Каждое изменение сразу
// идёт в engine.update (громкость слышна при перетаскивании, сохраняется в sedmaya.audio) и коротко
// подтверждается надписью «Сохранено» (role=status). Закрывается крестиком, Esc и «Готово».
import type { AudioEngine, AudioSettings, Melody } from './audio';

export const MELODY_NAMES: Record<Melody, string> = {
  waltz: 'Вальс',
  march: 'Марш',
  wind: 'Тишина и ветер',
};

/** Как часто звучит пробный звук при перетаскивании ползунка, мс. */
const PREVIEW_GAP = 160;
/** То же для порыва ветра у «Атмосферы», мс. */
const GUST_GAP = 700;
/** Сколько держится «Сохранено», мс. */
const SAVED_MS = 1600;
const LEAVE_MS = 200;

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  n.append(...children);
  return n;
}

let uid = 0;

export interface SettingsDeps {
  engine: AudioEngine;
  /** Пробный звук эффектов (уже с учётом громкости и выключателей). */
  preview(): void;
  /** Пробный порыв ветра для ряда «Атмосфера». */
  previewAmbience?(): void;
}

/** Открыть окно в host; повторный вызов при открытом окне только переводит в него фокус. */
export function openSettings(host: HTMLElement, deps: SettingsDeps): void {
  const existing = host.querySelector<HTMLElement>('.st-layer:not(.is-leaving) .st');
  if (existing) {
    existing.focus();
    return;
  }
  const { engine } = deps;
  const id = `st${++uid}`;
  const returnFocus = document.activeElement as HTMLElement | null;
  const offs: (() => void)[] = [];

  const saved = el('span', { class: 'st-saved', role: 'status', 'aria-live': 'polite' });
  let savedTimer = 0;
  const confirm = () => {
    saved.textContent = 'Сохранено';
    saved.classList.remove('is-on');
    void saved.offsetWidth;
    saved.classList.add('is-on');
    window.clearTimeout(savedTimer);
    savedTimer = window.setTimeout(() => saved.classList.remove('is-on'), SAVED_MS);
  };
  const set = (patch: Partial<AudioSettings>) => {
    engine.update(patch);
    confirm();
  };

  let previewAt = 0;
  const preview = () => {
    const now = performance.now();
    if (now - previewAt < PREVIEW_GAP) return;
    previewAt = now;
    deps.preview();
  };
  // Порыв ветра длиннее щелчка: при перетаскивании не чаще раза в 0,7 с, чтобы не сливаться в гул
  let gustAt = 0;
  const previewAmb = () => {
    const now = performance.now();
    if (now - gustAt < GUST_GAP) return;
    gustAt = now;
    deps.previewAmbience?.();
  };

  /** Выключатель: checkbox с role=switch, вся строка — подпись (палец попадает в любое место). */
  function toggle(label: string, get: () => boolean, put: (on: boolean) => void, hint?: string) {
    const input = el('input', { type: 'checkbox', role: 'switch', class: 'st-switch-in' });
    const row = el(
      'label',
      { class: 'st-switch' },
      el('span', { class: 'st-name' }, label, ...(hint ? [el('small', {}, hint)] : [])),
      input,
      el('span', { class: 'st-knob', 'aria-hidden': 'true' }),
    );
    const paint = () => {
      input.checked = get();
    };
    input.addEventListener('change', () => put(input.checked));
    return { row, input, paint };
  }

  /** Ползунок 0–100 с подписью и значением рядом (output). */
  function slider(label: string, get: () => number, put: (v: number) => void, onDrag?: () => void) {
    const inputId = `${id}-r${++uid}`;
    const input = el('input', {
      type: 'range',
      min: '0',
      max: '100',
      step: '5',
      id: inputId,
      class: 'st-range',
    });
    const out = el('output', { class: 'st-val num', for: inputId });
    const head = el('div', { class: 'st-head' }, el('label', { class: 'st-name', for: inputId }, label), out);
    const row = el('div', { class: 'st-slider' }, head, input);
    const paint = () => {
      const v = Math.round(get() * 100);
      input.value = String(v);
      out.textContent = `${v}%`;
      input.setAttribute('aria-valuetext', `${v}%`);
      row.style.setProperty('--st-fill', `${v}%`);
    };
    input.addEventListener('input', () => {
      put(Number(input.value) / 100);
      onDrag?.();
    });
    return { row, input, paint };
  }

  const mute = toggle(
    'Без звука',
    () => engine.settings.muted,
    (on) => set({ muted: on }),
    'Клавиша M',
  );
  const master = slider(
    'Общая громкость',
    () => engine.settings.master,
    (v) => set({ master: v }),
    preview,
  );
  const musicOn = toggle(
    'Музыка',
    () => engine.settings.musicOn,
    (on) => set({ musicOn: on }),
  );
  const music = slider(
    'Громкость музыки',
    () => engine.settings.music,
    (v) => set({ music: v }),
  );
  const ambOn = toggle(
    'Атмосфера',
    () => engine.settings.ambienceOn,
    (on) => {
      set({ ambienceOn: on });
      if (on) deps.previewAmbience?.();
    },
    'Ветер, двигатель, Мгла',
  );
  const amb = slider(
    'Громкость атмосферы',
    () => engine.settings.ambience,
    (v) => set({ ambience: v }),
    previewAmb,
  );
  const sfxOn = toggle(
    'Звуки',
    () => engine.settings.sfxOn,
    (on) => {
      set({ sfxOn: on });
      if (on) deps.preview();
    },
  );
  const sfx = slider(
    'Громкость звуков',
    () => engine.settings.sfx,
    (v) => set({ sfx: v }),
    preview,
  );

  // Мелодия дня: радиокнопки как плашки; стрелки ходят по ним штатно
  const melodyName = `${id}-melody`;
  const melodyInputs = (Object.keys(MELODY_NAMES) as Melody[]).map((m) => {
    const input = el('input', { type: 'radio', name: melodyName, value: m, class: 'st-opt-in' });
    input.addEventListener('change', () => {
      if (input.checked) set({ melody: m });
    });
    return { m, input, label: el('label', { class: 'st-opt' }, input, el('span', {}, MELODY_NAMES[m])) };
  });
  const melody = el(
    'fieldset',
    { class: 'st-melody' },
    el('legend', { class: 'st-name' }, 'Мелодия'),
    el('div', { class: 'st-opts' }, ...melodyInputs.map((x) => x.label)),
    el('small', { class: 'st-note' }, 'Играет днём; у ночи и финала свои темы.'),
  );

  const paintAll = () => {
    for (const c of [mute, master, musicOn, music, ambOn, amb, sfxOn, sfx]) c.paint();
    const s = engine.settings;
    for (const c of [master, musicOn, music, ambOn, amb, sfxOn, sfx])
      c.row.classList.toggle('is-off', s.muted);
    music.input.disabled = s.muted || !s.musicOn;
    amb.input.disabled = s.muted || !s.ambienceOn;
    sfx.input.disabled = s.muted || !s.sfxOn;
    master.input.disabled = s.muted;
    for (const x of melodyInputs) {
      x.input.checked = x.m === s.melody;
      x.input.disabled = s.muted || !s.musicOn;
    }
    melody.classList.toggle('is-off', s.muted || !s.musicOn);
  };
  paintAll();
  offs.push(engine.onSettings(paintAll));

  const closeX = el('button', { type: 'button', class: 'st-x', 'aria-label': 'Закрыть настройки' }, '×');
  const done = el('button', { type: 'button', class: 'btn st-done' }, 'Готово');
  const dialog = el(
    'section',
    {
      class: 'paper st',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': `${id}-title`,
      tabindex: '-1',
    },
    el(
      'header',
      { class: 'st-top' },
      el(
        'div',
        {},
        el('span', { class: 'lbl' }, 'Пульт башни'),
        el('h2', { class: 'disp st-title', id: `${id}-title` }, 'Настройки'),
      ),
      closeX,
    ),
    el(
      'div',
      { class: 'st-body' },
      el('div', { class: 'st-group' }, mute.row, master.row),
      el('div', { class: 'st-group' }, musicOn.row, music.row, melody),
      el('div', { class: 'st-group' }, ambOn.row, amb.row),
      el('div', { class: 'st-group' }, sfxOn.row, sfx.row),
    ),
    el('footer', { class: 'st-foot' }, saved, done),
  );
  const layer = el('div', { class: 'st-layer' }, el('div', { class: 'st-backdrop' }), dialog);

  let closing = false;
  function close() {
    if (closing) return;
    closing = true;
    for (const off of offs) off();
    document.removeEventListener('keydown', onKey, true);
    window.clearTimeout(savedTimer);
    layer.classList.add('is-leaving');
    window.setTimeout(() => layer.remove(), reduced() ? 0 : LEAVE_MS);
    returnFocus?.focus?.({ preventScroll: true });
  }
  // Esc закрывает, Tab ходит по кругу внутри окна. Слушаем на захвате, чтобы Esc не закрыл и меню под окном.
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...dialog.querySelectorAll<HTMLElement>('button, input:not([disabled])')].filter(
      (n) => !(n instanceof HTMLInputElement && n.type === 'radio' && !n.checked),
    );
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  closeX.addEventListener('click', close);
  done.addEventListener('click', close);
  layer.querySelector('.st-backdrop')?.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);

  host.append(layer);
  mute.input.focus({ preventScroll: true });
}
