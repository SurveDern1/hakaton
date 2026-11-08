// Составные звуки событий: файл (samples.ts) и синтез (sfx.ts) в такт картинке. Вызывает index.ts по
// причинам из stateCues (cues.ts) и по классам интерфейса; лаборатория и check:sound меряют их целиком.
// - сброс яруса: стон металла сразу, синтез обрывов, свиста и удара по DROP (в такт FALL_MS башни),
//   облегчённый скрип дерева на DROP.relief;
// - листок календаря: отрыв бумаги (фрагмент файла, каждый раз чуть иначе), в красный день — отзвук;
// - рычаг двигателя: файл чуть выше вверх и ниже вниз; разгон или затихание гула делает фон.

import { synthCreak } from './ambience';
import type { AudioEngine } from './audio';
import { dbGain, EVENT_TRIM_DB } from './mix';
import { playSample, sampleBuffer } from './samples';
import { DROP, playSfx } from './sfx';
import { noise, vary } from './synth';

/** Сброс яруса `tier` (0 — Корень): чем выше ярус, тем тяжелее стон — длиннее и ниже. */
export function playTierDrop(e: AudioEngine, tier = 0, delay = 0): void {
  if (!e.ready || !e.sfxAudible) return;
  const rnd = e.rnd;
  const pan = tier % 2 ? 0.25 : -0.25;
  const rate = Math.max(0.65, 0.8 - 0.02 * tier) * vary(rnd, 3);
  if (sampleBuffer('creakMetal')) playSample(e, 'creakMetal', { rate, pan, delay, gain: 1.1 });
  else if (e.ctx) synthCreak(e, e.ctx.currentTime + 0.01 + delay, e.sfxBus, pan, true);
  playSfx(e, 'tierDrop', delay);
  playSample(e, 'creakWood', { rate: 0.9 * vary(rnd, 4), pan: -pan, delay: delay + DROP.relief, gain: 0.8 });
  const ctx = e.ctx;
  if (ctx) mark(e, 'tierDrop:thud', ctx.currentTime + 0.01 + delay + DROP.thud);
}

/** Листок календаря отрывается; `red` — 7 ноября, следом отзвук медных с колоколом. */
export function playCalendar(e: AudioEngine, red = false, delay = 0): void {
  const gain = vary(e.rnd, 8) * dbGain(EVENT_TRIM_DB.calendar);
  playSample(e, 'paperTear', { rate: vary(e.rnd, 5), pan: -0.2, gain, delay });
  // листок слетает: мягкий шорох следом за отрывом — тело звука без лишнего пика
  const ctx = e.ctx;
  if (ctx && e.ready && e.sfxAudible)
    noise(e, {
      t: ctx.currentTime + 0.01 + delay + 0.16,
      dur: 0.2,
      attack: 0.06,
      release: 0.22,
      gain: 0.22 * vary(e.rnd, 10),
      dest: e.sfxBus,
      filter: 'bandpass',
      freq: 2600,
      to: 1500,
      q: 0.9,
      pan: 0.25,
    });
  if (red) playSfx(e, 'calendarRed', delay + 0.32);
}

/** Рычаг двигателя: вверх — чуть выше и быстрее, вниз — ниже и тяжелее. */
export function playLever(e: AudioEngine, dir: 1 | -1 = 1, delay = 0): void {
  const rate = (dir > 0 ? 1.06 : 0.9) * vary(e.rnd, 3);
  playSample(e, 'lever', { rate, gain: vary(e.rnd, 6) * dbGain(EVENT_TRIM_DB.lever), delay });
}

/** Отметка в журнале `played` без звука: когда по расписанию придёт важный момент (удар сброса). */
function mark(e: AudioEngine, name: string, t: number): void {
  e.played.push([name, Math.round(t * 100) / 100]);
  if (e.played.length > 40) e.played.shift();
}
