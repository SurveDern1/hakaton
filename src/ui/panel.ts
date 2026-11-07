// Правая панель дня по Main.dc.html (на телефоне — нижняя с вкладками, Mobile.dc.html):
// показатели с изменением за ночь, фракции, декреты, «Надстроить ярус», прогноз на ночь и режим
// двигателя, «Завершить день». Прогноз — forecastNight (тот же расчёт, что ночью), причины красной
// кнопки — forecastWarnings. Действия идут через GameLoop.act; вне фазы «день» панель inert.
import {
  type ActionResult,
  decreeBlocker,
  type EngineMode,
  etherNeed,
  type FactionKey,
  factionStance,
  forecastNight,
  forecastWarnings,
  type GameData,
  type GameState,
  newTierCost,
  residentsByTier,
  type StatKey,
  setEngineMode,
  startNewTier,
  toggleDecree,
} from '../core';
import type { GameLoop } from '../game/loop';
import type { GameStore } from '../game/store';
import type { StatusLine } from './feedback';
import { decreeText, FACTION_NAMES, fmtNum, h, plural, RES_NAMES, sgn } from './format';
import { FACTION_ICONS, svgIcon } from './portraits';

export interface PanelOptions {
  store: GameStore;
  data: GameData;
  loop: GameLoop;
  status: StatusLine;
  /** Всплывающее число над плиткой после действия. */
  flash(key: string, delta: number): void;
}

const STATS: StatKey[] = ['trust', 'solidarity', 'health', 'order'];
const MARKS: Record<StatKey, string> = {
  trust: 'trustRumors',
  solidarity: 'solidarityCrisis',
  health: 'healthDeaths',
  order: 'orderTheft',
};
const FACTIONS: FactionKey[] = ['stokers', 'institute', 'mistborn', 'sky'];
const MODES: { id: EngineMode; name: string }[] = [
  { id: 'save', name: 'Экономия' },
  { id: 'hold', name: 'Держать' },
  { id: 'climb', name: 'Набор' },
];
const MODE_PHRASE: Record<EngineMode, string> = {
  hold: 'держать высоту',
  climb: 'набирать высоту',
  save: 'экономить эфир',
};
const TABS = [
  { id: 'stats', name: 'Шкалы' },
  { id: 'factions', name: 'Фракции' },
  { id: 'decrees', name: 'Декреты' },
  { id: 'night', name: 'Ночь' },
] as const;

export interface Panel {
  aside: HTMLElement;
  engine: HTMLElement;
}

export function mountPanel(root: HTMLElement, opts: PanelOptions): Panel {
  const { store, data, loop, status } = opts;
  const b = data.balance;

  const tabs = h('div', { class: 'panel-tabs', role: 'tablist', 'aria-label': 'Панели' });
  const stats = h('section', { class: 'panel-sec', 'data-tab': 'stats', 'aria-label': 'Показатели' });
  const factions = h('section', { class: 'panel-sec', 'data-tab': 'factions', 'aria-label': 'Фракции' });
  const decrees = h('section', { class: 'panel-sec', 'data-tab': 'decrees', 'aria-label': 'Декреты' });
  const tower = h('section', { class: 'panel-sec panel-tower', 'data-tab': 'night', 'aria-label': 'Башня' });
  const forecast = h('section', {
    class: 'panel-sec panel-forecast',
    'data-tab': 'night',
    'aria-label': 'Прогноз на ночь',
  });
  const warn = h('div', { class: 'panel-warn', role: 'status', 'aria-live': 'polite' });
  const end = h('button', { type: 'button', class: 'btn panel-end' }, 'Завершить день');
  const body = h('div', { class: 'panel-body' }, stats, factions, decrees, tower, forecast);
  const aside = h(
    'aside',
    { class: 'panel', 'aria-label': 'Управление башней' },
    tabs,
    body,
    h('div', { class: 'panel-foot' }, warn, end),
  );
  const engine = h('div', { class: 'engine-plaque' });
  root.append(aside, engine);

  // Вкладки работают только на узком экране; на широком все секции видны сразу.
  let tab: string = 'stats';
  for (const t of TABS) {
    const btn = h('button', { type: 'button', class: 'tab', role: 'tab', 'data-tab': t.id }, t.name);
    btn.addEventListener('click', () => {
      tab = t.id;
      syncTabs();
    });
    tabs.append(btn);
  }
  function syncTabs() {
    for (const btn of tabs.querySelectorAll<HTMLElement>('.tab'))
      btn.setAttribute('aria-selected', String(btn.dataset.tab === tab));
    for (const sec of body.querySelectorAll<HTMLElement>('.panel-sec'))
      sec.classList.toggle('is-tab', sec.dataset.tab === tab);
  }
  syncTabs();

  function run(action: (s: GameState) => ActionResult, ok: (before: GameState, after: GameState) => string) {
    const before = store.state;
    const r = loop.act(action);
    if (!r.ok) {
      status.say(r.reason, 'bad');
      return;
    }
    status.say(ok(before, r.state));
    for (const k of ['pop', 'food', 'ether', 'mat'] as const) {
      const d = r.state.res[k] - before.res[k];
      if (d) opts.flash(k, d);
    }
  }

  end.addEventListener('click', () => {
    if (loop.phase !== 'day') return;
    end.disabled = true;
    void loop.endDay();
  });

  aside.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!t || t.getAttribute('aria-disabled') === 'true') return;
    const act = t.dataset.act;
    const id = t.dataset.id ?? '';
    if (act === 'mode') {
      const mode = id as EngineMode;
      run(
        (s) => ({ ok: true, state: setEngineMode(s, mode) }),
        () => `Двигатель: ${MODE_PHRASE[mode]}`,
      );
    } else if (act === 'decree') {
      const name = b.decrees.list[id]?.name ?? id;
      run(
        (s) => toggleDecree(s, data, id),
        (_, after) => (after.decrees.includes(id) ? `Введён декрет «${name}»` : `Декрет «${name}» отменён`),
      );
    } else if (act === 'tier') {
      run(
        (s) => startNewTier(s, data),
        (before, after) =>
          `Заложен новый ярус · ${before.res.mat - after.res.mat} мат. · встанет через ${b.tower.newTier.nights} ${plural(b.tower.newTier.nights, 'ночь', 'ночи', 'ночей')}`,
      );
    }
  });

  loop.onPhase((phase) => {
    aside.inert = phase !== 'day';
    aside.classList.toggle('is-idle', phase !== 'day');
    end.disabled = phase !== 'day';
    end.textContent = phase === 'night' ? 'Ночь…' : 'Завершить день';
  });

  store.subscribe((s) => {
    // Перерисовка заменяет кнопки — вернуть фокус на ту же кнопку для клавиатуры
    const active = document.activeElement as HTMLElement | null;
    const focusKey =
      active && aside.contains(active) && active.dataset.act
        ? `[data-act="${active.dataset.act}"][data-id="${active.dataset.id ?? ''}"]`
        : '';
    render(s);
    if (focusKey)
      aside.querySelector<HTMLElement>(focusKey.replace('[data-id=""]', ''))?.focus({ preventScroll: true });
  });

  function render(s: GameState) {
    const f = forecastNight(s, data);
    const warnings = forecastWarnings(f);
    const t = b.thresholds;

    stats.innerHTML = `<span class="lbl">Показатели</span>${STATS.map((k) => {
      const v = s.stats[k];
      const mark = t[MARKS[k]] ?? 0;
      const tone = v < mark ? 'bad' : v < mark + 20 ? 'warn' : 'good';
      const d = f.delta.stats[k];
      const dTone = d < 0 ? 'bad' : d > 0 ? 'good' : 'muted';
      return `<div class="stat ${tone}" data-key="${k}">
        <div class="stat-row"><span>${RES_NAMES[k]}</span><span class="num stat-v">${v}${d ? ` <span class="${dTone}">· ${sgn(d)} ночью</span>` : ''}</span></div>
        <div class="scale" role="meter" aria-label="${RES_NAMES[k]}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${v}"><div class="scale-fill" style="width:${v}%"></div><div class="scale-mark" style="left:${mark}%"></div></div>
      </div>`;
    }).join('')}`;

    factions.innerHTML = `<span class="lbl">Фракции</span><div class="fac-grid">${FACTIONS.map((k) => {
      const v = s.factions[k];
      const st = factionStance(s, b, k);
      const word = st === 'ally' ? 'союз' : st === 'enemy' ? 'вражда' : '';
      return `<div class="fac ${st ?? ''}" data-key="${k}" title="${word || 'нейтралитет'}">
        <span class="fac-ico">${svgIcon(FACTION_ICONS[k] ?? '')}</span>
        <span class="fac-name">${FACTION_NAMES[k]}</span>
        <span class="num fac-v ${v > 0 ? 'good' : v < 0 ? 'bad' : 'muted'}">${sgn(v).replace('±', '')}${word ? ` <small>${word}</small>` : ''}</span>
      </div>`;
    }).join('')}</div>`;

    const list = Object.entries(b.decrees.list).filter(
      ([id, d]) => s.decrees.includes(id) || d.fromDay <= s.day + 3,
    );
    decrees.innerHTML = `<div class="sec-head"><span class="lbl">Декреты</span><span class="lbl num">${s.decrees.length} из ${b.decrees.maxActive}</span></div>
      ${list
        .map(([id, d]) => {
          const on = s.decrees.includes(id);
          const why = on ? null : decreeBlocker(s, data, id);
          return `<div class="decree${on ? ' is-on' : ''}">
          <div class="decree-txt"><span class="decree-name">${d.name}</span><span class="decree-fx">${why ?? decreeText(d)}</span></div>
          <button type="button" class="btn small ${on ? 'ochre' : 'ink'}" data-act="decree" data-id="${id}" aria-pressed="${on}"${why ? ' aria-disabled="true"' : ''}>${on ? 'Отменить' : 'Ввести'}</button>
        </div>`;
        })
        .join('')}`;

    const cost = newTierCost(s, b);
    const tierWhy = s.building
      ? `Ярус строится: встанет через ${s.building.nightsLeft} ${plural(s.building.nightsLeft, 'ночь', 'ночи', 'ночей')}`
      : s.tiers.length >= b.tower.maxTiers
        ? 'Башня выше не станет'
        : s.res.mat < cost
          ? `Нужно ${cost} материалов`
          : null;
    tower.innerHTML = `<div class="tower-row">
      <div class="decree-txt"><span class="decree-name">Надстроить ярус</span><span class="decree-fx">${tierWhy ?? `+3 места под здания · встанет под Шпилем через ${b.tower.newTier.nights} ${plural(b.tower.newTier.nights, 'ночь', 'ночи', 'ночей')}`}</span></div>
      <button type="button" class="btn small ink" data-act="tier"${tierWhy ? ' aria-disabled="true"' : ''}>${cost} мат.</button>
    </div>`;

    const { homeless } = residentsByTier(s, b);
    const need = etherNeed(s, b);
    const rows: [string, string, string][] = [
      [
        `Еда: +${f.produced.food ?? 0}, съедят ${f.foodEaten}`,
        `${s.res.food} → ${s.res.food + f.delta.res.food}`,
        f.delta.res.food < 0 ? 'bad' : '',
      ],
      [
        `Эфир: +${f.produced.ether ?? 0}, сжечь ${f.etherBurned}`,
        `${s.res.ether} → ${s.res.ether + f.delta.res.ether}`,
        f.etherShortfall > 0 || f.delta.res.ether < 0 ? 'bad' : '',
      ],
      [`Мгла поднимется на ${fmtNum(f.mistRise)} м`, `до ${fmtNum(s.mist + f.delta.mist)} м`, ''],
      [
        `Высота днища`,
        `${fmtNum(s.altitude)} → ${fmtNum(s.altitude + f.altitudeDelta)} м`,
        f.altitudeDelta < 0 ? 'bad' : '',
      ],
    ];
    if (homeless) rows.push([`Без жилья: ${homeless} чел.`, `здоровье`, 'bad']);
    if (f.tiersInMist.length)
      rows.push([`В Мгле ярусов: ${f.tiersInMist.length}`, f.newlySubmerged.length ? 'новый!' : '', 'bad']);
    if (s.modifiers.length)
      rows.push([`Действует: ${s.modifiers.map((m) => m.label ?? m.id).join(', ')}`, '', 'muted']);
    forecast.innerHTML = `<span class="lbl">Прогноз на ночь</span>
      <div class="num fc-grid">${rows.map(([a, v, tone]) => `<span>${a}</span><span class="${tone}">${v}</span>`).join('')}</div>
      <div class="modes" role="group" aria-label="Режим двигателя">${MODES.map((m) => {
        const mode = b.engine.modes[m.id];
        const burn = Math.ceil(need * mode.burnFactor);
        const on = s.engineMode === m.id;
        const alt = mode.altitude ? `${sgn(mode.altitude)} м` : `${fmtNum(s.altitude)} м`;
        return `<button type="button" class="mode${on ? ' is-on' : ''}" data-act="mode" data-id="${m.id}" aria-pressed="${on}">${m.name}<br><span>${alt} · ${burn} эфира</span></button>`;
      }).join('')}</div>`;

    warn.innerHTML = warnings.length
      ? `<span class="warn-ico" aria-hidden="true">!</span><span>${warnings.join('. ')}</span>`
      : '';
    warn.classList.toggle('is-on', warnings.length > 0);
    end.classList.toggle('is-alarm', warnings.length > 0);
    end.setAttribute('aria-describedby', warnings.length ? 'panel-warn' : '');
    warn.id = 'panel-warn';

    const burn = Math.ceil(need * b.engine.modes[s.engineMode].burnFactor);
    engine.innerHTML = `<span class="plaque ether">Двигатель</span><span>${MODE_PHRASE[s.engineMode]} · сжечь ${burn} эфира за ночь</span>`;
  }

  return { aside, engine };
}
