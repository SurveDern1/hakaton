// Верхняя панель поверх canvas: календарь и ресурсы. Обычный DOM, стили — src/ui/style.css.
import type { GameState } from '../core';
import type { GameStore } from '../game/store';

const LABELS: [keyof GameState['res'] | keyof GameState['stats'], string][] = [
  ['pop', 'Люди'],
  ['food', 'Еда'],
  ['ether', 'Эфир'],
  ['mat', 'Материалы'],
  ['trust', 'Доверие'],
  ['solidarity', 'Сплочённость'],
  ['health', 'Здоровье'],
  ['order', 'Порядок'],
];

export function mountHud(root: HTMLElement, store: GameStore, firstDay: string): void {
  const bar = document.createElement('header');
  bar.className = 'hud';
  root.append(bar);

  store.subscribe((s) => {
    const date = new Date(`${firstDay}T00:00:00`);
    date.setDate(date.getDate() + s.day - 1);
    const day = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    const values: Record<string, number> = { ...s.res, ...s.stats };
    bar.innerHTML = `
      <div class="hud-day"><span class="lbl">День ${s.day}</span><span class="disp">${day}</span></div>
      <ul class="hud-stats">
        ${LABELS.map(([k, name]) => `<li><span class="lbl">${name}</span><span class="num">${values[k]}</span></li>`).join('')}
      </ul>`;
  });
}
