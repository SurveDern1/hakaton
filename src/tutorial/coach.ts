// Карточка-подсказка обучения и рамка цели поверх экрана (макет design/project/Tutorial.dc.html,
// классы .tut* из sedmaya.css). mountCoach(root) → show(view, target) / confirm() / hide() / welcome().
// Порядок: show ставит карточку в слой .tut-layer (z 35) → на каждом кадре requestAnimationFrame цель
// ищется заново по якорю, её прямоугольник и лист меню стройки идут в placeCard (place.ts), стиль пишется
// только при изменении → confirm показывает «Получилось» и уводит карточку. Под карточкой всё нажимается:
// pointer-events только у самой карточки. Модальное только приветствие welcome().
import { dispText } from '../ui/format';
import { placeCard, type Rect, visibleIn } from './place';
import './tutorial.css';

export interface CoachView {
  title?: string;
  text: string;
  /** Карточка-действие: что сделать («Нажмите на пустое место в Корне»); основной кнопки нет. */
  action?: string;
  /** «3 из 11» в углу карточки. */
  count?: string;
  /** Подпись голоса над заголовком (Р1). */
  voice?: string;
  /** Кнопка «Понятно» (по умолчанию есть, если нет `action`). */
  ok?: string | false;
  /** Ссылка «Пропустить обучение»; false — без неё. */
  skip?: string | false;
  onOk?: () => void;
  onSkip?: () => void;
}

/** Цель: селектор (ищется заново на каждом кадре), элемент, функция или null — карточка по центру. */
export type CoachTarget = string | Element | (() => Element | null) | null;

export interface CoachSample {
  phase: 'in' | 'out';
  /** мс от начала появления или ухода */
  t: number;
  opacity: number;
  /** сдвиг translateY, px */
  dy: number;
}

export interface CoachOptions {
  /** Рамка, в которой держится карточка; по умолчанию #app. */
  frame?: HTMLElement;
  /** Что карточка обходит, кроме цели (селекторы видимых элементов). */
  avoid?: string[];
  voice?: string;
  labels?: { ok?: string; skip?: string; success?: string };
}

export interface Coach {
  show(view: CoachView, target?: CoachTarget): void;
  /** «Получилось» около holdMs, затем уход. */
  confirm(label?: string, holdMs?: number): Promise<void>;
  hide(): Promise<void>;
  /** Модальное приветствие по центру: true — «Покажи», false — «Я разберусь сам» или Esc. */
  welcome(view: CoachView, yes: string, no: string): Promise<boolean>;
  readonly visible: boolean;
  /** Прозрачность и сдвиг карточки по кадрам за последнее появление и уход. */
  readonly samples: CoachSample[];
  /** Последнее положение: сторона, прямоугольники карточки и цели в координатах рамки. */
  readonly last: { side: string; card: Rect; target: Rect | null } | null;
  destroy(): void;
}

const STAR =
  '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.9 6.9 7.1.6-5.4 4.7 1.7 7-6.3-3.9-6.3 3.9 1.7-7L1.9 9.5l7.1-.6z" fill="var(--ochre)"></path></svg>';
const STAR_BIG =
  '<svg width="56" height="56" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.9 6.9 7.1.6-5.4 4.7 1.7 7-6.3-3.9-6.3 3.9 1.7-7L1.9 9.5l7.1-.6z" fill="var(--red)"></path></svg>';
const TARGET_ICON =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="3" fill="currentColor"></circle><circle cx="12" cy="12" r="8"></circle></svg>';
const CHECK =
  '<svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="13" fill="var(--ether-deep)"></circle><path d="M8 14.5l4 4 8-9" fill="none" stroke="var(--paper)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path></svg>';

/** Длительности из sedmaya.css (tutIn, tutOut): запас на случай, если animationend не придёт. */
const IN_MS = 220;
const OUT_MS = 180;
/** Рамка шире цели на столько с каждой стороны (как в макете). */
const RING_PAD = 6;

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function resolve(target: CoachTarget | undefined, cached: Element | null): Element | null {
  if (!target) return null;
  if (cached?.isConnected) return cached;
  if (typeof target === 'string') return document.querySelector(target);
  if (typeof target === 'function') return target();
  return target.isConnected ? target : null;
}

function relRect(r: DOMRect, frame: DOMRect): Rect {
  return { x: r.left - frame.left, y: r.top - frame.top, w: r.width, h: r.height };
}

const sameRect = (a: Rect | null, b: Rect | null) =>
  a === b ||
  (!!a &&
    !!b &&
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.w - b.w) < 0.5 &&
    Math.abs(a.h - b.h) < 0.5);

/** translateY из вычисленного transform (matrix(a,b,c,d,e,f) → f). */
function translateY(transform: string): number {
  const m = transform.match(/matrix(3d)?\(([^)]+)\)/);
  if (!m?.[2]) return 0;
  const v = m[2].split(',').map(Number);
  return (m[1] ? v[13] : v[5]) ?? 0;
}

export function mountCoach(root: HTMLElement, opts: CoachOptions = {}): Coach {
  const frameEl = opts.frame ?? document.getElementById('app') ?? document.body;
  const avoidSel = opts.avoid ?? ['.bmenu:not([hidden])'];
  const labels = { ok: 'Понятно', skip: 'Пропустить обучение', success: 'Получилось', ...opts.labels };
  const voice = opts.voice ?? 'Секретарь Совета';

  // Текст читается через role="status" самой карточки (aria-live polite); фокус она не забирает.
  const layer = el('div', 'tut-layer');
  root.append(layer);

  let card: HTMLElement | null = null;
  let ring: HTMLElement | null = null;
  let target: CoachTarget | undefined = null;
  let targetEl: Element | null = null;
  let frameRect = frameEl.getBoundingClientRect();
  let cardSize = { w: 0, h: 0 };
  let raf = 0;
  let lastTarget: Rect | null | undefined;
  let lastPlace = '';
  let last: Coach['last'] = null;
  let samples: CoachSample[] = [];
  let sampling: { phase: 'in' | 'out'; start: number; node: HTMLElement; until: number } | null = null;
  let welcomeDone: ((v: boolean) => void) | null = null;

  const onResize = () => {
    frameRect = frameEl.getBoundingClientRect();
    lastTarget = undefined;
  };
  const frameObs = new ResizeObserver(onResize);
  frameObs.observe(frameEl);
  window.addEventListener('resize', onResize);
  const cardObs = new ResizeObserver(() => {
    if (card) cardSize = { w: card.offsetWidth, h: card.offsetHeight };
    lastTarget = undefined;
  });

  function sample(now: number): void {
    if (!sampling) return;
    const cs = getComputedStyle(sampling.node);
    samples.push({
      phase: sampling.phase,
      t: Math.max(0, Math.round(now - sampling.start)),
      opacity: Number(cs.opacity),
      dy: Math.round(translateY(cs.transform) * 100) / 100,
    });
    if (now - sampling.start > sampling.until) sampling = null;
  }

  // Один getBoundingClientRect цели за кадр (и меню стройки, когда оно открыто); пишем только при изменении.
  function tick(now: number): void {
    raf = 0;
    if (!card) return;
    sample(now);
    targetEl = resolve(target, targetEl);
    let tRect: Rect | null = targetEl ? relRect(targetEl.getBoundingClientRect(), frameRect) : null;
    const frame: Rect = { x: 0, y: 0, w: frameRect.width, h: frameRect.height };
    if (tRect && !visibleIn(tRect, frame)) tRect = null;
    const avoid: Rect[] = [];
    for (const sel of avoidSel)
      for (const a of document.querySelectorAll(sel)) {
        if (a === targetEl || a.contains(targetEl) || card.contains(a)) continue;
        avoid.push(relRect(a.getBoundingClientRect(), frameRect));
      }
    const key = JSON.stringify(avoid);
    if (lastTarget === undefined || !sameRect(tRect, lastTarget) || key !== lastPlace) {
      lastTarget = tRect;
      lastPlace = key;
      place(tRect, frame, avoid);
    }
    raf = requestAnimationFrame(tick);
  }

  function place(tRect: Rect | null, frame: Rect, avoid: Rect[]): void {
    if (!card) return;
    if (!cardSize.w) cardSize = { w: card.offsetWidth, h: card.offsetHeight };
    const p = placeCard(tRect, cardSize, frame, avoid);
    card.style.left = `${p.x}px`;
    card.style.top = `${p.y}px`;
    card.classList.toggle('at-top', p.side === 'below');
    card.classList.toggle('at-bottom', p.side === 'above');
    card.classList.toggle('is-center', p.side === 'center');
    if (p.arrowX !== null) card.style.setProperty('--ax', `${p.arrowX}px`);
    last = { side: p.side, card: { x: p.x, y: p.y, w: cardSize.w, h: cardSize.h }, target: tRect };
    if (!ring) return;
    ring.hidden = !tRect;
    if (tRect) {
      // Рамка не вылезает за рамку экрана, иначе её край обрезан.
      const x = Math.max(2, tRect.x - RING_PAD);
      const y = Math.max(2, tRect.y - RING_PAD);
      ring.style.left = `${x}px`;
      ring.style.top = `${y}px`;
      ring.style.width = `${Math.min(frame.w - 2, tRect.x + tRect.w + RING_PAD) - x}px`;
      ring.style.height = `${Math.min(frame.h - 2, tRect.y + tRect.h + RING_PAD) - y}px`;
    }
  }

  function startSampling(phase: 'in' | 'out', node: HTMLElement): void {
    if (phase === 'in') samples = [];
    const now = performance.now();
    sampling = { phase, start: now, node, until: (phase === 'in' ? IN_MS : OUT_MS) + 40 };
    sample(now);
  }

  /** Уводит карточку и рамку; завершается, когда уход доиграл. */
  function leave(node: HTMLElement | null, ringNode: HTMLElement | null): Promise<void> {
    ringNode?.remove();
    if (!node) return Promise.resolve();
    node.classList.add('is-out');
    node.style.pointerEvents = 'none';
    startSampling('out', node);
    const outSample = () => {
      if (sampling?.node !== node) return;
      sample(performance.now());
      if (sampling) requestAnimationFrame(outSample);
    };
    requestAnimationFrame(outSample);
    return new Promise((done) => {
      const finish = () => {
        node.remove();
        done();
      };
      if (reducedMotion()) return finish();
      const timer = setTimeout(finish, OUT_MS + 80);
      node.addEventListener('animationend', (e) => {
        if (e.target !== node) return;
        clearTimeout(timer);
        finish();
      });
    });
  }

  function buildCard(view: CoachView, extra = ''): HTMLElement {
    const c = el('div', `tut${extra}`);
    c.setAttribute('role', 'status');
    const head = el('div', 'tut-head');
    const plaque = el('span', 'plaque ink tut-voice');
    plaque.innerHTML = STAR;
    plaque.append(view.voice ?? voice);
    head.append(plaque);
    if (view.count) head.append(el('span', 'tut-count', view.count));
    c.append(head);
    if (view.title) c.append(el('h3', 'tut-title', view.title));
    c.append(el('p', 'tut-text', view.text));
    if (view.action) {
      const act = el('div', 'tut-do');
      act.innerHTML = TARGET_ICON;
      act.append(view.action);
      c.append(act);
    }
    const foot = el('div', 'tut-foot');
    const skip = view.skip ?? labels.skip;
    if (skip !== false) {
      const b = el('button', 'tut-skip', skip);
      b.type = 'button';
      b.dataset.act = 'skip';
      foot.append(b);
    }
    const ok = view.ok ?? (view.action ? false : labels.ok);
    if (ok !== false) {
      const b = el('button', 'btn small', ok);
      b.type = 'button';
      b.dataset.act = 'ok';
      foot.append(b);
    }
    if (foot.childElementCount) c.append(foot);
    return c;
  }

  function show(view: CoachView, to: CoachTarget = null): void {
    finishWelcome(false);
    const prev = card;
    const prevRing = ring;
    void leave(prev, prevRing);
    target = to;
    targetEl = null;
    lastTarget = undefined;
    lastPlace = '';

    const c = buildCard(view);
    c.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'ok') view.onOk?.();
      if (act === 'skip') view.onSkip?.();
    });
    // Esc — только при фокусе внутри карточки, равен «Понятно» (у карточки-действия — ничего).
    c.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || view.action) return;
      e.preventDefault();
      e.stopPropagation();
      view.onOk?.();
    });
    const r = el('div', 'tut-ring');
    r.setAttribute('aria-hidden', 'true');
    r.hidden = true;
    layer.append(r, c);
    card = c;
    ring = r;
    cardObs.disconnect();
    cardObs.observe(c);
    cardSize = { w: c.offsetWidth, h: c.offsetHeight };
    frameRect = frameEl.getBoundingClientRect();
    if (raf) cancelAnimationFrame(raf);
    tick(performance.now());
    startSampling('in', c);
  }

  async function hide(): Promise<void> {
    finishWelcome(false);
    const c = card;
    const r = ring;
    card = null;
    ring = null;
    target = null;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    cardObs.disconnect();
    await leave(c, r);
  }

  async function confirm(label = labels.success, holdMs = 700): Promise<void> {
    const c = card;
    if (!c) return;
    c.classList.add('is-done');
    c.querySelector('.tut-foot')?.remove();
    const ok = el('div', 'tut-ok');
    ok.innerHTML = CHECK;
    ok.append(label);
    c.append(ok);
    await new Promise((r) => setTimeout(r, holdMs));
    if (card === c) await hide();
  }

  function finishWelcome(v: boolean): void {
    const done = welcomeDone;
    welcomeDone = null;
    done?.(v);
  }

  function welcome(view: CoachView, yes: string, no: string): Promise<boolean> {
    void hide();
    const veil = el('div', 'tut-veil');
    const c = el('div', 'tut tut-welcome is-center');
    c.setAttribute('role', 'dialog');
    c.setAttribute('aria-modal', 'true');
    c.setAttribute('aria-labelledby', 'tut-w-title');
    const emblem = el('div', 'tut-emblem');
    emblem.innerHTML = STAR_BIG;
    const plaque = el('span', 'plaque ink tut-voice');
    plaque.style.alignSelf = 'center';
    plaque.innerHTML = STAR;
    plaque.append(view.voice ?? voice);
    c.append(emblem, plaque);
    const title = el('h3', 'tut-title disp');
    title.append(dispText(view.title ?? ''));
    title.id = 'tut-w-title';
    c.append(title, el('p', 'tut-text', view.text));
    const bYes = el('button', 'btn', yes);
    const bNo = el('button', 'btn ink', no);
    bYes.type = bNo.type = 'button';
    c.append(bYes, bNo);
    layer.append(veil, c);
    startSampling('in', c);
    const sampleIn = () => {
      if (sampling?.node !== c) return;
      sample(performance.now());
      if (sampling) requestAnimationFrame(sampleIn);
    };
    requestAnimationFrame(sampleIn);
    const before = document.activeElement as HTMLElement | null;
    bYes.focus();
    return new Promise((resolveWelcome) => {
      welcomeDone = (v) => {
        veil.remove();
        void leave(c, null).then(() => before?.focus?.());
        resolveWelcome(v);
      };
      bYes.addEventListener('click', () => finishWelcome(true));
      bNo.addEventListener('click', () => finishWelcome(false));
      c.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          finishWelcome(false);
        } else if (e.key === 'Tab') {
          // Фокус не уходит из приветствия, пока игрок не выбрал.
          e.preventDefault();
          (document.activeElement === bYes ? bNo : bYes).focus();
        }
      });
    });
  }

  return {
    show,
    confirm,
    hide,
    welcome,
    get visible() {
      return !!card || !!welcomeDone;
    },
    get samples() {
      return samples;
    },
    get last() {
      return last;
    },
    destroy() {
      if (raf) cancelAnimationFrame(raf);
      frameObs.disconnect();
      cardObs.disconnect();
      window.removeEventListener('resize', onResize);
      layer.remove();
    },
  };
}
