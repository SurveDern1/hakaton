// Утренний отчёт о ночи (ТЗ 3.1): NightReport → строки полосы над первым окном события.
// Если событий утром нет, тот же отчёт показывается отдельной карточкой с кнопкой «За работу».
import type { GameData, NightReport } from '../core';
import type { MorningReport } from './event-window';
import { dayDate, fmtDate, fmtNum, h, plural, sgn } from './format';

/** Строки отчёта: произведено и съедено, эфир, Мгла, высота, смерти, кражи, ярусы. */
export function morningReport(report: NightReport, data: GameData, day: number): MorningReport {
  const items: string[] = [];
  const p = report.produced;
  items.push(
    `Еда ${sgn(p.food ?? 0)}, съели ${report.foodEaten}${report.foodShortage ? ' — не хватило!' : ''}`,
  );
  items.push(
    `Эфир ${sgn(p.ether ?? 0)}, сожгли ${report.etherBurned}${report.etherShortfall > 0 ? ' — не хватило!' : ''}`,
  );
  if (p.mat) items.push(`Материалы ${sgn(p.mat)}`);
  items.push(`Мгла ${sgn(report.mistRise)} м`);
  if (report.altitudeDelta) items.push(`Высота ${sgn(report.altitudeDelta)} м`);
  if (report.deaths) items.push(`Умерли от болезней: ${report.deaths}`);
  if (report.theft.food || report.theft.mat)
    items.push(`Украли: еды ${report.theft.food}, мат. ${report.theft.mat}`);
  if (report.sabotage) items.push('Саботаж в Корне');
  if (report.tierBuilt) items.push('Новый ярус встал под Шпилем');
  if (report.newlySubmerged.length)
    items.push(
      `${report.newlySubmerged.length} ${plural(report.newlySubmerged.length, 'ярус ушёл', 'яруса ушли', 'ярусов ушли')} в Мглу`,
    );
  if (report.abandoned.length) items.push('Ярус заброшен');
  if (report.homeless) items.push(`Без жилья: ${report.homeless}`);
  if (report.expiredModifiers.length) items.push(`Закончилось: ${report.expiredModifiers.length}`);
  return { title: `Отчёт о ночи на ${fmtDate(dayDate(data, day))}`, items };
}

/** Карточка отчёта, когда утром нет событий. Промис — после «За работу» (или Enter/Esc). */
export function showReportCard(root: HTMLElement, report: MorningReport, mistNote: string): Promise<void> {
  return new Promise((resolve) => {
    const go = h('button', { type: 'button', class: 'btn' }, 'За работу');
    const card = h(
      'section',
      { class: 'paper report-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'report-title' },
      h('span', { class: 'lbl', id: 'report-title' }, report.title),
      h('h2', { class: 'disp report-head' }, 'Утро без происшествий'),
      h('ul', { class: 'num report-list' }, ...report.items.map((t) => h('li', {}, t))),
      h('p', { class: 'serif report-note' }, mistNote),
      go,
    );
    const layer = h('div', { class: 'ev-layer report-layer' }, h('div', { class: 'ev-backdrop' }), card);
    const done = () => {
      layer.classList.add('is-leaving');
      window.setTimeout(() => {
        layer.remove();
        resolve();
      }, 200);
    };
    go.addEventListener('click', done, { once: true });
    layer.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') go.click();
      if (e.key === 'Tab') {
        e.preventDefault();
        go.focus();
      }
    });
    root.append(layer);
    go.focus({ preventScroll: true });
  });
}

/** Подпись под отчётом: насколько Мгла близко к днищу. */
export function mistNote(altitude: number, mist: number): string {
  const gap = altitude - mist;
  if (gap <= 0) return `Мгла уже выше днища на ${fmtNum(-gap)} м. Корень в тумане.`;
  return `До Мглы под днищем ${fmtNum(gap)} м.`;
}
