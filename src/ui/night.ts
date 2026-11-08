// Анимация ночи (ТЗ 3.1): 2–3 с. Вуаль темнеет, окна башни гаснут, посередине commit() подменяет
// состояние — Мгла поднимается медленным переходом сцены, затем рассвет. Без движения — короткая пауза
// с надписью и сразу утро.
import type { GameData } from '../core';
import { dayDate, fmtDate, h } from './format';

export interface NightScene {
  setNight(on: boolean): void;
  tweenMs: number;
}

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Длительности интерфейса, мс (не баланс): затемнение, подъём Мглы, рассвет
const T_DUSK = 600;
const T_RISE = 1300;
const T_DAWN = 500;

export async function playNight(
  root: HTMLElement,
  scene: NightScene,
  data: GameData,
  day: number,
  commit: () => void,
) {
  const label = h(
    'div',
    { class: 'night-label', role: 'status', 'aria-live': 'polite' },
    h('span', { class: 'lbl' }, 'Отбой'),
    // Неразрывный пробел перед стрелкой: при переносе она остаётся с первой датой
    h('span', { class: 'disp' }, `${fmtDate(dayDate(data, day))} → ${fmtDate(dayDate(data, day + 1))}`),
  );
  const veil = h('div', { class: 'night-veil' }, label);
  root.append(veil);
  if (reduced()) {
    veil.classList.add('is-on');
    commit();
    await wait(700);
    veil.remove();
    return;
  }
  void veil.offsetWidth;
  veil.classList.add('is-on');
  scene.setNight(true);
  await wait(T_DUSK);
  const prev = scene.tweenMs;
  scene.tweenMs = T_RISE;
  commit();
  await wait(T_RISE + 100);
  scene.tweenMs = prev;
  scene.setNight(false);
  veil.classList.remove('is-on');
  await wait(T_DAWN);
  veil.remove();
}
