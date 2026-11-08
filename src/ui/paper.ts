// Стенгазета по Paper.dc.html: бортовой журнал (state.log) короткими заметками.
// Главная заметка — первая запись последнего дня, справа — ночь (из последнего отчёта), склад и
// «Радио Седьмой отвечает» (data/flavor.json, вопрос по номеру дня) и журнал прошлых дней.
// Открывается кнопкой «Стенгазета», закрывается Esc или «Закрыть».
import { forecastWarnings, type GameData, type GameState, type NightReport, residentsByTier } from '../core';
import { dayDate, dispText, fmtDate, fmtNum, h } from './format';

export interface Paper {
  open(state: GameState, report: NightReport | null, forecast: NightReport): void;
  close(): void;
}

/** Заголовок газеты без точки на конце, как в Paper.dc.html; многоточие и «!»/«?» остаются. */
const noDot = (t: string) => t.trim().replace(/([^.]).$/, '$1');

export function mountPaper(root: HTMLElement, data: GameData): Paper {
  let layer: HTMLElement | null = null;
  let returnFocus: HTMLElement | null = null;

  function close() {
    if (!layer) return;
    const l = layer;
    layer = null;
    l.classList.add('is-leaving');
    window.setTimeout(() => l.remove(), 200);
    returnFocus?.focus({ preventScroll: true });
  }

  function open(s: GameState, report: NightReport | null, forecast: NightReport) {
    close();
    returnFocus = document.activeElement as HTMLElement | null;
    const date = dayDate(data, s.day);
    const days = [...new Set(s.log.map((e) => e.day))].sort((a, b) => b - a);
    const lastDay = days[0];
    const today = s.log.filter((e) => e.day === lastDay).map((e) => e.text);
    const [headline, ...rest] = today;
    const older = s.log.filter((e) => e.day !== lastDay).reverse();

    const main = h(
      'article',
      { class: 'pp-main' },
      h('span', { class: 'plaque' }, 'Главное'),
      h('h2', { class: 'disp pp-h2' }, dispText(headline ? noDot(headline) : 'Башня держится')),
      h(
        'p',
        { class: 'serif pp-p' },
        rest.length
          ? rest.join(' ')
          : headline
            ? `Это решение Совета ${lastDay === s.day ? 'сегодня' : `дня ${lastDay}`} обсуждают на всех лестницах.`
            : 'Первый номер. Совет просит жителей беречь эфир и держаться вместе.',
      ),
    );
    const { homeless } = residentsByTier(s, data.balance);
    const warnings = forecastWarnings(forecast);
    const box =
      homeless > 0
        ? [
            String(homeless),
            `${homeless === 1 ? 'человек ночует' : 'человек ночуют'} на лестницах. Совет просит заложить жилой модуль.`,
          ]
        : warnings[0]
          ? ['!', warnings[0]]
          : null;
    if (box)
      main.append(
        h(
          'div',
          { class: 'pp-box' },
          h('span', { class: 'disp pp-box-n' }, box[0] ?? ''),
          h('span', {}, box[1] ?? ''),
        ),
      );

    const side = h('div', { class: 'pp-side' });
    const note = (title: string, text: string) =>
      side.append(
        h('article', { class: 'pp-note' }, h('h3', {}, title), h('p', { class: 'serif num' }, text)),
      );
    if (report) {
      note(
        `Мгла поднялась на ${fmtNum(report.mistRise)} м`,
        `Ночью туман подошёл к отметке ${fmtNum(s.mist)} м. Кочегары держат днище на ${fmtNum(s.altitude)} метрах и сожгли ${report.etherBurned} мер эфира.`,
      );
      note(
        'Склад считает пайки',
        `На складе ${s.res.food} мер еды. За ночь съели ${report.foodEaten}, фермы дали ${report.produced.food ?? 0}.${report.foodShortage ? ' Еды не хватило.' : ''}`,
      );
    } else {
      note('Мгла внизу', `Туман стоит на отметке ${fmtNum(s.mist)} м, днище — на ${fmtNum(s.altitude)} м.`);
    }
    // «Радио Седьмой отвечает»: вопрос дня по номеру номера газеты, без случайности
    const radio = data.flavor.radio;
    const qa = radio.length ? radio[(s.day - 1) % radio.length] : undefined;
    if (qa)
      side.append(
        h(
          'article',
          { class: 'pp-note pp-radio' },
          h('h3', {}, 'Радио Седьмой отвечает'),
          h('p', { class: 'serif' }, h('b', {}, 'Спрашивают: '), qa.q),
          h('p', { class: 'serif' }, h('b', {}, 'Отвечаем: '), qa.a),
        ),
      );
    if (older.length) {
      side.append(
        h(
          'article',
          { class: 'pp-note pp-log' },
          h('h3', {}, 'Бортовой журнал'),
          h('ul', {}, ...older.map((e) => h('li', {}, h('b', { class: 'num' }, `День ${e.day}. `), e.text))),
        ),
      );
    }

    const closeBtn = h('button', { type: 'button', class: 'btn ink small pp-close' }, 'Закрыть');
    closeBtn.addEventListener('click', close);
    const sheet = h(
      'section',
      { class: 'paper pp', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pp-title' },
      h('div', { class: 'pp-tape l' }),
      h('div', { class: 'pp-tape r' }),
      h(
        'header',
        { class: 'pp-head' },
        h(
          'div',
          {},
          h('span', { class: 'lbl' }, 'Стенгазета башни «Седьмое ноября» · Бортовой журнал'),
          h('h1', { class: 'disp pp-title', id: 'pp-title' }, dispText('За высоту!')),
        ),
        h(
          'div',
          { class: 'pp-issue' },
          h('span', { class: 'plaque ink num' }, `№ ${s.day}`),
          h(
            'span',
            { class: 'num' },
            `${fmtDate(date, { day: 'numeric', month: 'long', year: 'numeric' }).replace(' г.', '')} · ${fmtDate(date, { weekday: 'long' })}`,
          ),
        ),
      ),
      h('div', { class: 'pp-cols' }, main, side),
      closeBtn,
    );
    layer = h('div', { class: 'ev-layer pp-layer' }, h('div', { class: 'ev-backdrop' }), sheet);
    layer.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('ev-backdrop')) close();
    });
    layer.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });
    root.append(layer);
    closeBtn.focus({ preventScroll: true });
  }

  return { open, close };
}
