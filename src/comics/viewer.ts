// Просмотрщик комикса поверх игры: playComic(root, comic) → Promise, который выполняется, когда
// комикс дочитан или пропущен.
// Порядок: страница проявляется по кадрам (подпись → звук → облачка) → касание справа, стрелка, пробел
// или кнопка «Дальше» дорисовывают страницу, потом листают → лист поворачивается на корешке слева
// и открывает следующую страницу (жест пальцем ведёт лист за собой; отпустил — лист доходит или
// возвращается) → после последней страницы слой гаснет. Esc и «Пропустить» — сразу конец.
// При prefers-reduced-motion листы сменяются наплывом, кадры появляются без движения.
// Каждый поворот листа — событие `comic:turn` на слое (звук в src/audio).
import { h } from '../ui/format';
import { type Comic, type ComicPage, type ComicPanel, pageGrid } from './data';
import { ComicNav } from './nav';
import { placeholderArt } from './placeholder';
import './comic.css';

export interface ComicOptions {
  /** Подпись кнопки на последней странице, вместо comic.finish. */
  finish?: string;
}

const TURN_MS = 760;
const TURN_REDUCED_MS = 220;
/** Пауза между кадрами при проявлении страницы и добавка за каждое облачко. */
const PANEL_MS = 560;
const BUBBLE_MS = 300;
const LEAVE_MS = 460;

const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`;

/** Сколько угла (градусов) проходит лист: чуть больше 90°, чтобы он ушёл ребром из кадра. */
const LEAF_DEG = 94;

interface Turn {
  dir: 1 | -1;
  /** Лист, который поворачивается: при «дальше» — текущая страница, при «назад» — прошлая. */
  leaf: HTMLElement;
  /** Страница под листом. */
  under: HTMLElement;
  /** Новая страница, которая станет текущей. */
  incoming: HTMLElement;
  p: number;
}

export function playComic(root: HTMLElement, comic: Comic, opts: ComicOptions = {}): Promise<void> {
  return new Promise((resolve) => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const total = comic.pages.length;
    const nav = new ComicNav(comic.pages.map((p) => p.panels.length));
    const finishLabel = opts.finish ?? comic.finish ?? 'Дальше';

    const book = h('div', { class: 'cx-book' });
    const counter = h('span', { class: 'lbl num cx-count' });
    const dots = h('div', { class: 'cx-dots', 'aria-hidden': 'true' }, ...comic.pages.map(() => h('i', {})));
    const live = h('div', { class: 'cx-live', role: 'status', 'aria-live': 'polite' });
    const prevBtn = h('button', { type: 'button', class: 'ibtn cx-prev', 'aria-label': 'Назад' });
    prevBtn.innerHTML = ARROW_LEFT;
    const nextBtn = h('button', { type: 'button', class: 'btn small cx-next' });
    const skipBtn = h('button', { type: 'button', class: 'cx-skip' }, 'Пропустить');
    const layer = h(
      'div',
      {
        class: `cx-layer${reduced ? ' is-reduced' : ''}`,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': comic.title,
        tabindex: '-1',
      },
      h('div', { class: 'cx-top' }, h('span', { class: 'lbl cx-name' }, comic.title), counter, skipBtn),
      book,
      h('div', { class: 'cx-bottom' }, prevBtn, dots, nextBtn),
      live,
    );

    let cur = renderPage(comic.pages[0] as ComicPage, 0, total);
    cur.classList.add('is-first');
    book.append(cur);
    root.append(layer);
    layer.focus({ preventScroll: true });
    preload(1);

    let turn: Turn | null = null;
    let animating = false;
    let ended = false;
    let revealTimer = 0;
    /** До этого момента на странице ещё появляются тексты; касание показывает их сразу. */
    let settleUntil = 0;

    // ---- Проявление кадров ----
    const panelsOf = (page: HTMLElement) => [...page.querySelectorAll<HTMLElement>('.cx-panel')];
    const markSettle = (panel: HTMLElement | undefined) => {
      settleUntil = Math.max(settleUntil, performance.now() + Number(panel?.dataset.settle ?? 0));
    };
    function settleNow(): void {
      settleUntil = 0;
      cur.classList.add('is-settled');
    }
    function revealNext(): void {
      const i = nav.shown;
      if (!nav.revealOne()) return;
      const panel = panelsOf(cur)[i];
      panel?.classList.add('is-in');
      markSettle(panel);
      sync();
      if (!nav.complete) {
        const bubbles = panel?.querySelectorAll('.cx-bubble').length ?? 0;
        revealTimer = window.setTimeout(revealNext, PANEL_MS + bubbles * BUBBLE_MS);
      }
    }
    function startReveal(delay: number): void {
      window.clearTimeout(revealTimer);
      if (reduced) {
        nav.next();
        for (const p of panelsOf(cur)) {
          p.classList.add('is-in');
          markSettle(p);
        }
        sync();
        return;
      }
      revealTimer = window.setTimeout(revealNext, delay);
    }
    function revealAll(): void {
      window.clearTimeout(revealTimer);
      nav.next();
      for (const p of panelsOf(cur)) p.classList.add('is-in');
      settleNow();
      sync();
    }

    // ---- Поворот листа ----
    function beginTurn(dir: 1 | -1): Turn | null {
      const target = nav.page + dir;
      if (target < 0 || target >= total) return null;
      settleUntil = 0;
      const incoming = renderPage(comic.pages[target] as ComicPage, target, total);
      if (dir < 0) {
        for (const p of panelsOf(incoming)) p.classList.add('is-in', 'is-instant');
        incoming.classList.add('is-settled');
      }
      const t: Turn =
        dir > 0
          ? { dir, leaf: cur, under: incoming, incoming, p: 0 }
          : { dir, leaf: incoming, under: cur, incoming, p: 0 };
      cur.classList.remove('is-first');
      t.leaf.classList.add('is-leaf');
      t.under.classList.add('is-under');
      if (dir > 0) book.insertBefore(incoming, cur);
      else book.append(incoming);
      window.clearTimeout(revealTimer);
      layer.dispatchEvent(new CustomEvent('comic:turn', { bubbles: true, detail: { dir, page: target } }));
      setTurn(t, 0);
      return t;
    }

    function setTurn(t: Turn, p: number): void {
      t.p = p;
      // q — насколько лист ушёл: 0 — лежит, 1 — ушёл ребром
      const q = t.dir > 0 ? p : 1 - p;
      if (reduced) {
        t.leaf.style.opacity = String(1 - q);
        return;
      }
      t.leaf.style.transform = `rotateY(${(-LEAF_DEG * q).toFixed(2)}deg)`;
      t.leaf.style.setProperty('--shade', (q * 0.7).toFixed(3));
      t.leaf.style.setProperty('--gloss', Math.sin(q * Math.PI).toFixed(3));
      t.leaf.style.setProperty('--gx', `${(100 - q * 120).toFixed(1)}%`);
      t.under.style.transform = `scale(${(0.93 + 0.07 * q).toFixed(4)})`;
      t.under.style.setProperty('--cast', ((1 - q) * 0.6).toFixed(3));
    }

    function animateTo(t: Turn, to: number, ms: number, ease: (x: number) => number): Promise<void> {
      const from = t.p;
      const start = performance.now();
      return new Promise((done) => {
        const frame = (now: number) => {
          const k = Math.min(1, (now - start) / ms);
          setTurn(t, from + (to - from) * ease(k));
          if (k < 1) requestAnimationFrame(frame);
          else done();
        };
        requestAnimationFrame(frame);
      });
    }

    async function completeTurn(t: Turn, commit: boolean, ms: number, ease = easeInOut): Promise<void> {
      animating = true;
      await animateTo(t, commit ? 1 : 0, ms, ease);
      if (commit) {
        const old = cur;
        cur = t.incoming;
        old.remove();
        nav.turn(t.dir);
        live.textContent = `Страница ${nav.page + 1} из ${total}`;
        preload(nav.page + 1);
      } else {
        t.incoming.remove();
      }
      for (const el of [t.leaf, t.under]) {
        el.classList.remove('is-leaf', 'is-under', 'is-first');
        el.style.removeProperty('transform');
        el.style.removeProperty('opacity');
        for (const v of ['--shade', '--gloss', '--gx', '--cast']) el.style.removeProperty(v);
      }
      turn = null;
      animating = false;
      sync();
      if (commit && t.dir > 0) startReveal(140);
      else if (!commit && !nav.complete) startReveal(200);
    }

    // ---- Команды ----
    function next(): void {
      if (animating || ended || turn) return;
      if (!nav.complete) {
        revealAll();
        return;
      }
      if (performance.now() < settleUntil) {
        settleNow();
        return;
      }
      if (nav.isLast) {
        finish();
        return;
      }
      const t = beginTurn(1);
      if (t) void completeTurn(t, true, reduced ? TURN_REDUCED_MS : TURN_MS);
    }
    function back(): void {
      if (animating || ended || turn) return;
      const t = beginTurn(-1);
      if (t) void completeTurn(t, true, reduced ? TURN_REDUCED_MS : TURN_MS);
    }
    function finish(): void {
      if (ended) return;
      ended = true;
      window.clearTimeout(revealTimer);
      document.removeEventListener('keydown', onKey);
      layer.classList.add('is-leaving');
      window.setTimeout(
        () => {
          layer.remove();
          resolve();
        },
        reduced ? 160 : LEAVE_MS,
      );
    }

    function sync(): void {
      counter.textContent = `${nav.page + 1} / ${total}`;
      [...dots.children].forEach((d, i) => {
        d.classList.toggle('is-on', i === nav.page);
        d.classList.toggle('is-past', i < nav.page);
      });
      prevBtn.disabled = nav.page === 0;
      const last = nav.isLast && nav.complete;
      nextBtn.textContent = last ? finishLabel : 'Дальше';
      nextBtn.classList.toggle('ink', !last);
      nextBtn.classList.toggle('is-ready', last);
    }

    function preload(index: number): void {
      for (const p of comic.pages[index]?.panels ?? []) {
        if (p.image) new Image().src = asset(p.image);
      }
    }

    // ---- Ввод: касание, жест, клавиши ----
    nextBtn.addEventListener('click', next);
    prevBtn.addEventListener('click', back);
    skipBtn.addEventListener('click', finish);

    let drag: {
      id: number;
      x0: number;
      y0: number;
      moved: boolean;
      dir: 1 | -1;
      t: Turn | null;
      lastX: number;
      lastT: number;
      v: number;
    } | null = null;

    book.addEventListener('pointerdown', (e) => {
      if (animating || ended || drag || e.button > 0) return;
      drag = {
        id: e.pointerId,
        x0: e.clientX,
        y0: e.clientY,
        moved: false,
        dir: 1,
        t: null,
        lastX: e.clientX,
        lastT: e.timeStamp,
        v: 0,
      };
      try {
        book.setPointerCapture(e.pointerId);
      } catch {
        // указатель уже отпущен — жест доиграет без захвата
      }
    });
    book.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x0;
      const dy = e.clientY - drag.y0;
      if (!drag.moved) {
        if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy)) return;
        drag.moved = true;
        drag.dir = dx < 0 ? 1 : -1;
        drag.t = beginTurn(drag.dir);
        turn = drag.t;
      }
      const dt = Math.max(1, e.timeStamp - drag.lastT);
      drag.v = 0.7 * drag.v + 0.3 * ((e.clientX - drag.lastX) / dt);
      drag.lastX = e.clientX;
      drag.lastT = e.timeStamp;
      if (!drag.t) return;
      const w = book.clientWidth * 0.8;
      const p = clamp(drag.dir > 0 ? -dx / w : dx / w);
      setTurn(drag.t, p);
    });
    const release = (e: PointerEvent, cancelled: boolean) => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag;
      drag = null;
      if (!d.moved) {
        if (cancelled) return;
        const r = book.getBoundingClientRect();
        if (e.clientX - r.left < r.width * 0.3) back();
        else next();
        return;
      }
      if (!d.t) {
        // Смахнули последнюю страницу вперёд — комикс дочитан
        if (!cancelled && d.dir > 0 && nav.isLast) finish();
        return;
      }
      const fling = d.dir > 0 ? -d.v : d.v;
      const commit = !cancelled && (d.t.p > 0.4 || fling > 0.45);
      const rest = commit ? 1 - d.t.p : d.t.p;
      void completeTurn(d.t, commit, (reduced ? 120 : 180) + rest * (reduced ? 120 : 420), easeOut);
    };
    book.addEventListener('pointerup', (e) => release(e, false));
    book.addEventListener('pointercancel', (e) => release(e, true));

    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const onButton = e.target instanceof HTMLButtonElement && (e.key === 'Enter' || e.key === ' ');
      if (onButton) return;
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) next();
      else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) back();
      else if (e.key === 'Escape') finish();
      else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);

    sync();
    live.textContent = `${comic.title}. Страница 1 из ${total}`;
    // Первая картинка проявляется, когда загружена (не дольше 1,5 с ожидания), остальные — заранее
    preloadComic(comic);
    const firstImg = cur.querySelector('img');
    const ready =
      firstImg && !firstImg.complete
        ? Promise.race([firstImg.decode().catch(() => undefined), wait(1500)])
        : Promise.resolve();
    void ready.then(() => {
      if (!ended && nav.page === 0 && nav.shown === 0) startReveal(reduced ? 0 : 520);
    });
  });
}

function renderPage(page: ComicPage, index: number, total: number): HTMLElement {
  const g = pageGrid(page);
  const grid = h('div', { class: 'cx-grid' });
  const size = page.bleed ? page.panels[0]?.size : undefined;
  grid.style.gridTemplateAreas = g.areas;
  grid.style.gridTemplateColumns = `repeat(${g.columns}, minmax(0, 1fr))`;
  grid.style.gridTemplateRows = g.rows;
  page.panels.forEach((p, i) => {
    const el = renderPanel(p);
    el.style.gridArea = g.names[i] ?? 'auto';
    grid.append(el);
  });
  const section = h(
    'section',
    { class: `cx-page${size ? ' is-bleed' : ''}`, 'aria-label': `Страница ${index + 1} из ${total}` },
    h(
      'div',
      { class: 'cx-front' },
      grid,
      h('span', { class: 'cx-folio num', 'aria-hidden': 'true' }, `— ${index + 1} —`),
      h('div', { class: 'cx-shade' }),
      h('div', { class: 'cx-gloss' }),
    ),
    h('div', { class: 'cx-cast' }),
  );
  // Лист во весь размер картинки: его пропорция — пропорция картинки, лишнее книги остаётся фоном
  if (size) section.style.setProperty('--r', ratio(size));
  return section;
}

const ratio = ([w, h]: [number, number]) => (w / h).toFixed(4);

/** Пауза перед первым текстом на картинке (картинка успевает проявиться) и время на каждый следующий. */
const NOTE_START_MS = 420;
const noteStep = (text: string) => Math.min(1700, 650 + text.length * 5);

function renderPanel(p: ComicPanel): HTMLElement {
  let art: HTMLElement;
  // Картинка с известным размером — в рамке её пропорции: текст из notes привязан к картинке
  let frame: HTMLElement | null = null;
  if (p.image && p.size) {
    const img = h('img', {
      class: 'cx-art',
      src: asset(p.image),
      alt: p.alt ?? '',
      draggable: 'false',
      decoding: 'async',
    });
    frame = h('div', { class: 'cx-frame' }, img);
    frame.style.setProperty('--r', ratio(p.size));
    const [fx, fy] = (p.focus ?? '50% 50%').split(/\s+/).map((v) => Number.parseFloat(v) / 100);
    frame.style.setProperty('--fx', String(Number.isFinite(fx) ? fx : 0.5));
    frame.style.setProperty('--fy', String(Number.isFinite(fy) ? fy : 0.5));
    art = frame;
  } else if (p.image) {
    const img = h('img', {
      class: 'cx-art',
      src: asset(p.image),
      alt: p.alt ?? '',
      draggable: 'false',
      decoding: 'async',
    });
    if (p.focus) img.style.objectPosition = p.focus;
    art = img;
  } else {
    art = h('div', { class: 'cx-art', role: 'img', 'aria-label': p.alt ?? '' });
    art.innerHTML = placeholderArt(p.art?.scene ?? '', p.art?.tone);
  }
  const cam = h('div', { class: 'cx-cam' }, art);
  if (p.origin) cam.style.transformOrigin = p.origin;
  const el = h('figure', { class: 'cx-panel', 'data-move': p.move ?? 'in' }, cam);
  if (!p.image) el.append(h('span', { class: 'cx-stub', 'aria-hidden': 'true' }, 'эскиз'));
  let d = 0;
  const beat = (node: HTMLElement, step: number) => {
    node.style.setProperty('--d', `${d}ms`);
    d += step;
    el.append(node);
  };
  if (p.caption)
    beat(
      h('figcaption', { class: `cx-cap serif${p.captionAt === 'bottom' ? ' is-bottom' : ''}` }, p.caption),
      220,
    );
  if (p.sfx) beat(h('span', { class: 'cx-sfx disp', 'aria-hidden': 'true' }, p.sfx), 160);
  for (const b of p.bubbles ?? []) {
    const kind = b.kind ?? 'speech';
    const tail = b.tail ?? (kind === 'radio' ? 'none' : 'down');
    const bubble = h(
      'div',
      { class: `cx-bubble kind-${kind} tail-${tail}` },
      b.who ? h('b', { class: 'cx-who' }, b.who) : null,
      h('span', {}, b.text),
    );
    bubble.style.left = `${b.x}%`;
    bubble.style.top = `${b.y}%`;
    beat(bubble, BUBBLE_MS);
  }
  if (frame && p.notes?.length) {
    // Тексты художника: группа начинается с заметки с y, следующие без y встают под ней
    d = Math.max(d, NOTE_START_MS);
    let group: HTMLElement | null = null;
    for (const n of p.notes) {
      if (n.y !== undefined || !group) {
        group = h('div', { class: 'cx-notes' });
        group.style.setProperty('--x', String(n.x ?? 10));
        group.style.setProperty('--y', String(n.y ?? 10));
        group.style.setProperty('--w', String(n.w ?? 80));
        frame.append(group);
      }
      const cls = ['cx-note', `is-${n.style ?? 'box'}`];
      if (n.accent) cls.push('is-accent');
      if (n.align === 'center') cls.push('is-center');
      if (n.small) cls.push('is-small');
      const note = h('p', { class: cls.join(' ') }, h('span', {}, n.text));
      note.style.setProperty('--d', `${d}ms`);
      if (n.scale) note.style.setProperty('--ns', String(n.scale));
      d += noteStep(n.text);
      group.append(note);
    }
  }
  if (p.title) beat(h('span', { class: 'cx-title disp' }, p.title), 0);
  // Когда кадр «дописан»: касание до этого срока сначала показывает всё сразу, а не листает
  el.dataset.settle = String(d + 500);
  return el;
}

/** Загрузить картинки комикса заранее, например пока открыт стартовый экран. */
export function preloadComic(comic: Comic): void {
  for (const page of comic.pages)
    for (const p of page.panels) {
      if (p.image) new Image().src = asset(p.image);
    }
}

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const easeOut = (x: number) => 1 - (1 - x) ** 3;

const ARROW_LEFT =
  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
