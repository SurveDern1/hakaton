import Phaser from 'phaser';
import { APPEAR_MS, type SlotHandler, TowerDom } from './tower-dom';
import { buildTower, lerpInput, type TowerInput, type TowerModel } from './tower-model';

// Башня по макету renderTower (design/project/Tower.dc.html).
// Порядок: источник отдаёт TowerInput → твин Phaser интерполирует числа (высота, Мгла, эфир,
// показатели) → buildTower строит детали → TowerDom обновляет только изменившиеся div внутри
// DOMElement Phaser. Камера Phaser подгоняет рамку башни под экран, небо рисует Graphics.
// Детали — та же разметка и те же классы .tw .* из sedmaya.css, что и в макетах: вид совпадает,
// анимации деталей (пропеллеры, подушка, огни, флаги) идут на CSS.

export interface TowerSource {
  subscribe(listener: (input: TowerInput) => void): () => void;
}

export interface TowerSceneOptions {
  /** Отступы от краёв экрана, которые заняты интерфейсом (верхняя панель и т. п.). */
  insets?: () => { top: number; right: number; bottom: number; left: number };
  /** Подписи зданий на табличках, как на главном экране макета. */
  labels?: boolean;
  /**
   * Мгла ушла ниже кадра (башня крупно на узком экране): сколько метров до неё; null — Мгла видна.
   * Вызывается только при изменении.
   */
  onMistBelow?: (meters: number | null) => void;
}

/** Длительность перехода между состояниями — в диапазоне 300–600 мс. */
export const TWEEN_MS = 500;
const SKY = [
  [0, 0x1a3437],
  [0.48, 0x20444e],
  [0.78, 0x4f6a6d],
  [1, 0x7e9b9e],
] as const;
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 1.25;
/** Низ башни с двигателями и подушкой (px от днища): ниже — только воздух до Мглы. */
const TOWER_FOOT = 320;
/** Время, за которое камера проходит ~63 % пути к новой рамке. */
const CAMERA_LAG_MS = 140;
/** Камера ближе к цели, чем на это (px мира / доля масштаба), — встаёт точно в цель. */
const CAMERA_EPS = 0.05;
const ZOOM_EPS = 0.0005;
/** Сколько кадров подряд в покое, прежде чем цикл Phaser засыпает. */
const IDLE_FRAMES = 3;
/** Как часто спящая сцена проверяет отступы интерфейса (раскрытая панель и т. п.). */
const IDLE_POLL_MS = 250;

interface Frame {
  t: number;
  input: TowerInput;
}

export class TowerScene extends Phaser.Scene {
  private dom!: TowerDom;
  private sky!: Phaser.GameObjects.Graphics;
  private shown: TowerInput | null = null;
  private model: TowerModel | null = null;
  private tween: Phaser.Tweens.Tween | null = null;
  private cam = { x: 0, y: 0, zoom: 1, ready: false };
  private skyKey = '';
  private reduced = false;
  private unsubscribe?: () => void;
  /** Сэмплы последнего перехода для проверки плавности: window.sedmaya.tower.samples. */
  samples: { t: number; gapPx: number; tilt: number; zoom: number }[] = [];
  /** Длительность следующих переходов; ночь растягивает её, чтобы Мгла поднималась медленно. */
  tweenMs = TWEEN_MS;
  private pendingSlots: SlotHandler | null = null;
  private mistBelow: number | null | undefined;
  /** Кадров подряд без движения камеры и твинов; после IDLE_FRAMES цикл Phaser спит. */
  private idleFrames = 0;
  private idlePoll = 0;
  private insetsKey = '';

  constructor(
    private source: TowerSource,
    private options: TowerSceneOptions = {},
  ) {
    super('tower');
  }

  create(): void {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reduced = mq.matches;
    mq.addEventListener('change', (e) => {
      this.reduced = e.matches;
    });

    this.cameras.main.setBackgroundColor(SKY[0][1]);
    this.sky = this.add.graphics();
    this.dom = new TowerDom(() => !this.reduced);
    this.dom.setSlotHandler(this.pendingSlots);
    const el = this.add.dom(0, 0, this.dom.root).setOrigin(0, 0);
    el.pointerEvents = 'none';

    this.unsubscribe = this.source.subscribe((input) => this.show(input));
    this.scale.on('resize', () => this.fitCamera(true));
    // Окно меняет размер — Phaser подхватывает его только в своём цикле, поэтому будим
    const onResize = () => this.wake();
    window.addEventListener('resize', onResize);
    this.events.once('shutdown', () => {
      this.unsubscribe?.();
      window.removeEventListener('resize', onResize);
      window.clearInterval(this.idlePoll);
    });
  }

  /**
   * Разбудить цикл Phaser. В покое (камера на месте, твинов нет) он спит: небо и башня не меняются,
   * а перерисовка canvas и пересчёт камеры каждый кадр на телефоне стоят заметно. Будят новое
   * состояние, изменение окна и изменение отступов интерфейса (опрос раз в IDLE_POLL_MS).
   */
  wake(): void {
    this.idleFrames = 0;
    window.clearInterval(this.idlePoll);
    this.idlePoll = 0;
    const loop = this.game?.loop;
    if (!loop || loop.running) return;
    loop.resetDelta();
    // Часы твинов (Date.now) засчитали бы сон короче 500 мс как прошедшее время, и переход
    // перескочил бы к концу: сдвигаем их на длительность сна.
    const tw = this.tweens as unknown as { prevTime: number; startTime: number };
    const slept = Date.now() - tw.prevTime;
    tw.prevTime += slept;
    tw.startTime += slept;
    loop.wake();
  }

  private sleepIfIdle(moving: boolean): void {
    if (moving || this.tween) {
      this.idleFrames = 0;
      return;
    }
    if (++this.idleFrames < IDLE_FRAMES) return;
    this.game.loop.sleep();
    this.insetsKey = this.readInsetsKey();
    this.idlePoll = window.setInterval(() => {
      if (this.readInsetsKey() !== this.insetsKey) this.wake();
    }, IDLE_POLL_MS);
  }

  private readInsetsKey(): string {
    const ins = this.options.insets?.() ?? { top: 0, right: 0, bottom: 0, left: 0 };
    const { width, height } = this.scale;
    return [ins.top, ins.right, ins.bottom, ins.left, width, height].map(Math.round).join(',');
  }

  /** Новое состояние: первый раз — сразу, дальше — плавный переход от того, что на экране. */
  show(target: TowerInput): void {
    this.wake();
    const from = this.shown;
    this.tween?.stop();
    this.tween = null;
    if (!from || this.reduced) {
      this.render(target, from != null);
      return;
    }
    this.samples = [];
    const frame: Frame = { t: 0, input: from };
    this.render(lerpInput(from, target, 0), true);
    this.tween = this.tweens.add({
      targets: frame,
      t: 1,
      duration: this.tweenMs,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        this.render(lerpInput(from, target, frame.t), true);
        const m = this.model;
        if (m) this.samples.push({ t: frame.t, gapPx: m.gapPx, tilt: m.tilt, zoom: this.cam.zoom });
      },
      onComplete: () => {
        this.render(target, true);
        this.tween = null;
      },
    });
  }

  private render(input: TowerInput, animate: boolean): void {
    this.shown = input;
    this.model = buildTower(input, { labels: this.options.labels ?? false });
    this.dom.apply(this.model, animate);
    this.fitCamera(!animate);
  }

  update(_time: number, delta: number): void {
    this.sleepIfIdle(this.fitCamera(false, delta));
  }

  /** Рамка башни (от звезды до Мглы) по центру свободной части экрана. Возвращает: камера ещё едет. */
  private fitCamera(snap: boolean, delta = 16): boolean {
    const m = this.model;
    if (!m) return false;
    const { width, height } = this.scale;
    const ins = this.options.insets?.() ?? { top: 0, right: 0, bottom: 0, left: 0 };
    const pad = 12;
    const vw = Math.max(80, width - ins.left - ins.right - 2 * pad);
    const vh = Math.max(80, height - ins.top - ins.bottom - 2 * pad);
    const b = m.bounds;
    // Телефон: башня от звезды до двигателей — как можно крупнее; воздух до Мглы — сколько влезет.
    // Если всё не помещается, кадр прижат к звезде, а Мгла въезжает снизу, когда подходит близко.
    const towerH = Math.min(b.h, TOWER_FOOT - b.y);
    const fitAll = Math.min(vw / b.w, vh / b.h);
    const fitTower = Math.min(vw / b.w, vh / towerH);
    const zoom = Phaser.Math.Clamp(Math.max(fitAll, fitTower), ZOOM_MIN, ZOOM_MAX);
    const visH = vh / zoom;
    const cy = visH >= b.h ? b.y + b.h / 2 : b.y + visH / 2;
    // Центр свободной области смещён от центра экрана на разницу отступов
    const dx = (ins.left - ins.right) / 2;
    const dy = (ins.top - ins.bottom) / 2;
    const x = b.x + b.w / 2 - dx / zoom;
    const y = cy - dy / zoom;
    this.reportMist(b.y + visH < m.gapPx - 20);

    const c = this.cam;
    const near =
      Math.abs(x - c.x) < CAMERA_EPS && Math.abs(y - c.y) < CAMERA_EPS && Math.abs(zoom - c.zoom) < ZOOM_EPS;
    const moving = c.ready && !near && !snap && !this.reduced;
    if (!moving) {
      c.x = x;
      c.y = y;
      c.zoom = zoom;
      c.ready = true;
    } else {
      const k = 1 - Math.exp(-delta / CAMERA_LAG_MS);
      c.x += (x - c.x) * k;
      c.y += (y - c.y) * k;
      c.zoom += (zoom - c.zoom) * k;
    }
    const cam = this.cameras.main;
    cam.setZoom(c.zoom);
    cam.centerOn(c.x, c.y);
    this.drawSky();
    return moving;
  }

  private reportMist(hidden: boolean): void {
    const s = this.shown;
    const next = hidden && s ? Math.max(0, Math.round(s.altitude - s.mist)) : null;
    if (next === this.mistBelow) return;
    this.mistBelow = next;
    this.options.onMistBelow?.(next);
  }

  /** Небо во весь видимый прямоугольник: сверху тёмная бирюза, к Мгле светлее. */
  private drawSky(): void {
    const v = this.cameras.main.worldView;
    const key = `${Math.round(v.x)},${Math.round(v.y)},${Math.round(v.width)},${Math.round(v.height)}`;
    if (key === this.skyKey) return;
    this.skyKey = key;
    const g = this.sky.clear();
    const x = v.x - 4;
    const w = v.width + 8;
    for (let i = 1; i < SKY.length; i++) {
      const a = SKY[i - 1] as readonly [number, number];
      const b = SKY[i] as readonly [number, number];
      const y0 = v.y + a[0] * v.height;
      const y1 = v.y + b[0] * v.height;
      g.fillGradientStyle(a[1], a[1], b[1], b[1], 1);
      g.fillRect(x, y0 - 1, w, y1 - y0 + 2);
    }
  }

  /** Клики по слотам башни; null — выключить. Можно вызывать до create(). */
  setSlotHandler(handler: SlotHandler | null): void {
    this.pendingSlots = handler;
    this.dom?.setSlotHandler(handler);
  }

  selectSlot(tier: number | null, slot = 0): void {
    this.dom?.select(tier, slot);
  }

  slotElement(tier: number, slot: number): HTMLElement | null {
    return this.dom?.slotElement(tier, slot) ?? null;
  }

  /** Ночь: окна гаснут, башня темнеет (CSS .tw-game.is-night). */
  setNight(on: boolean): void {
    this.dom?.root.classList.toggle('is-night', on);
  }

  /** Сколько деталей в разметке и последний ход перехода — для отладки из консоли. */
  debug(): { parts: number; groups: string[]; appearMs: number } {
    return {
      parts: this.dom.count(),
      groups: this.model?.groups.map((g) => g.id) ?? [],
      appearMs: APPEAR_MS,
    };
  }
}
