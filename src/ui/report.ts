// Утренний отчёт о ночи (ТЗ 3.1): NightReport → строки полосы над первым окном события по Event.dc.html
// («Еда −3 (37)»: изменение за ночь и остаток). Если событий утром нет, тот же отчёт — отдельной карточкой.
import type { GameData, GameState, NightReport } from '../core';
import { type MorningReport, type ReportItem, reportItemNodes } from './event-window';
import { dayDate, fmtDate, fmtNum, h, plural, sgn } from './format';

/** Строки отчёта: еда, эфир, материалы, Мгла, высота с остатком; потери или «Все живы»; кражи, ярусы. */
export function morningReport(report: NightReport, data: GameData, state: GameState): MorningReport {
  const items: ReportItem[] = [];
  const d = report.delta;
  items.push({ text: `Еда ${sgn(d.res.food)}`, rest: String(state.res.food) });
  items.push({ text: `Эфир ${sgn(d.res.ether)}`, rest: String(state.res.ether) });
  if (d.res.mat) items.push({ text: `Материалы ${sgn(d.res.mat)}`, rest: String(state.res.mat) });
  items.push({ text: `Мгла ${sgn(report.mistRise)} м`, rest: `${fmtNum(state.mist)} м` });
  if (report.altitudeDelta)
    items.push({ text: `Высота ${sgn(report.altitudeDelta)} м`, rest: `${fmtNum(state.altitude)} м` });
  if (report.foodShortage) items.push({ text: 'Еды не хватило', tone: 'bad' });
  if (report.etherShortfall > 0) items.push({ text: 'Эфира не хватило', tone: 'bad' });
  if (report.deaths) items.push({ text: `Умерли от болезней: ${report.deaths}`, tone: 'bad' });
  else if (d.res.pop < 0) items.push({ text: `Жителей ${sgn(d.res.pop)}`, tone: 'bad' });
  else items.push({ text: 'Все живы' });
  if (report.theft.food || report.theft.mat)
    items.push({ text: `Украли: еды ${report.theft.food}, мат. ${report.theft.mat}`, tone: 'bad' });
  if (report.sabotage) items.push({ text: 'Саботаж в Корне', tone: 'bad' });
  if (report.tierBuilt) items.push({ text: 'Новый ярус встал под Шпилем' });
  if (report.newlySubmerged.length)
    items.push({
      text: `${report.newlySubmerged.length} ${plural(report.newlySubmerged.length, 'ярус ушёл', 'яруса ушли', 'ярусов ушли')} в Мглу`,
      tone: 'bad',
    });
  if (report.abandoned.length) items.push({ text: 'Ярус заброшен', tone: 'bad' });
  if (report.homeless) items.push({ text: `Без жилья: ${report.homeless}` });
  if (report.expiredModifiers.length) items.push({ text: `Закончилось: ${report.expiredModifiers.length}` });
  return { title: `Отчёт о ночи на ${fmtDate(dayDate(data, state.day))}`, items };
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
      h(
        'ul',
        { class: 'num report-list' },
        ...report.items.map((t) => {
          const li = h('li', { class: t.tone });
          li.append(...reportItemNodes(t));
          return li;
        }),
      ),
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
