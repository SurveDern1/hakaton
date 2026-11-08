// Верхняя панель по Main.dc.html: листок календаря, день, ресурсы с изменением за ночь (из прогноза),
// высота и Мгла, кнопки «Стенгазета» и меню. Плитки помечены data-key — над ними всплывают числа.
import { forecastNight, type GameData, type GameState, residentsByTier } from '../core';
import type { GameStore } from '../game/store';
import { dayDate, fmtDate, fmtNum, h, icon, sgn } from './format';

export interface HudOptions {
  store: GameStore;
  data: GameData;
  onPaper(): void;
  onMenu(): void;
  /** Кнопки перед меню (кнопка звука из src/audio, план звука Р6). */
  actions?: HTMLElement[];
}

const MODE_WORDS = { hold: 'держим', climb: 'набираем', save: 'экономим' } as const;

/** Плитка ресурса. short — подпись и строка изменения для узкой шапки телефона (6 плиток в ряд). */
function tile(
  key: string,
  name: string,
  color: string,
  value: string,
  sub: string,
  subTone: string,
  short: { name: string; sub: string },
): string {
  return `<div class="hud-tile" data-key="${key}">
    <span class="hud-ico" style="color:${color}">${icon(key)}</span>
    <div class="hud-val"><span class="lbl"><span class="hud-long">${name}</span><span class="hud-short">${short.name}</span></span><span class="num hud-num">${value}</span><span class="num hud-sub ${subTone}"><span class="hud-long">${sub}</span><span class="hud-short">${short.sub}</span></span></div>
  </div>`;
}

const tone = (d: number) => (d > 0 ? 'good' : d < 0 ? 'bad' : 'muted');

export function mountHud(root: HTMLElement, opts: HudOptions): HTMLElement {
  const { store, data } = opts;
  const days = data.balance.calendar.days;
  const bar = h('header', { class: 'hud' });
  const leaf = h('div', { class: 'leaf hud-leaf' });
  const title = h('div', { class: 'hud-title' });
  const tiles = h('div', { class: 'hud-tiles' });
  const paper = h('button', { type: 'button', class: 'btn ink small hud-paper' }, 'Стенгазета');
  const menu = h('button', { type: 'button', class: 'ibtn', 'aria-label': 'Меню', 'aria-haspopup': 'menu' });
  menu.innerHTML = icon('menu', 20);
  paper.addEventListener('click', opts.onPaper);
  menu.addEventListener('click', opts.onMenu);
  bar.append(leaf, title, tiles, h('div', { class: 'hud-actions' }, paper, ...(opts.actions ?? []), menu));
  root.append(bar);

  let lastDay = 0;
  store.subscribe((s: GameState) => {
    const date = dayDate(data, s.day);
    const last = s.day >= days;
    leaf.classList.toggle('is-final', last);
    leaf.innerHTML = `<div class="leaf-top">${fmtDate(date, { month: 'short' }).replace('.', '')} · ${date.getFullYear()}</div>
      <div class="disp num leaf-day">${date.getDate()}</div>
      <div class="leaf-week">${fmtDate(date, { weekday: 'long' })}</div>`;
    if (lastDay && s.day !== lastDay) {
      // Листок отрывается: новый день проявляется сверху
      leaf.classList.remove('is-turn');
      void leaf.offsetWidth;
      leaf.classList.add('is-turn');
    }
    lastDay = s.day;
    const left = days - s.day;
    title.innerHTML = `<span class="lbl">Башня «Седьмое ноября»</span>
      <span class="hud-daynum">День ${s.day} из ${days}</span>
      <span class="hud-left">${last ? 'Красный день календаря' : `До 7 ноября ${left} дн.`}</span>`;

    const f = forecastNight(s, data);
    const { homeless } = residentsByTier(s, data.balance);
    const d = f.delta.res;
    tiles.innerHTML = [
      tile(
        'pop',
        'Жители',
        'var(--paper)',
        String(s.res.pop),
        homeless ? `${homeless} без жилья` : 'все под крышей',
        homeless ? 'warn' : 'muted',
        { name: 'Жители', sub: homeless ? `${homeless} без жил.` : 'под крышей' },
      ),
      tile('food', 'Еда', 'var(--good)', String(s.res.food), `${sgn(d.food)} за ночь`, tone(d.food), {
        name: 'Еда',
        sub: sgn(d.food),
      }),
      tile('ether', 'Эфир', 'var(--ether)', String(s.res.ether), `${sgn(d.ether)} за ночь`, tone(d.ether), {
        name: 'Эфир',
        sub: sgn(d.ether),
      }),
      tile('mat', 'Материалы', 'var(--ochre)', String(s.res.mat), `${sgn(d.mat)} за ночь`, tone(d.mat), {
        name: 'Матер.',
        sub: sgn(d.mat),
      }),
      tile(
        'altitude',
        'Высота',
        'var(--paper)',
        `${fmtNum(s.altitude)} м`,
        f.altitudeDelta ? `${sgn(f.altitudeDelta)} м` : MODE_WORDS[s.engineMode],
        tone(f.altitudeDelta),
        { name: 'Высота', sub: f.altitudeDelta ? `${sgn(f.altitudeDelta)} м` : MODE_WORDS[s.engineMode] },
      ),
      tile('mist', 'Мгла', 'var(--mist-light)', `${fmtNum(s.mist)} м`, `${sgn(f.mistRise)} за ночь`, 'bad', {
        name: 'Мгла',
        sub: `${sgn(f.mistRise)} м`,
      }),
    ].join('');
  });
  return bar;
}
