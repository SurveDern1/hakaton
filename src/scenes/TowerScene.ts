import Phaser from 'phaser';
import { APPEAR_MS, TowerDom } from './tower-dom';
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
/** Время, за которое камера проходит ~63 % пути к новой рамке. */
const CAMERA_LAG_MS = 140;

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
    const el = this.add.dom(0, 0, this.dom.root).setOrigin(0, 0);
    el.pointerEvents = 'none';

    this.unsubscribe = this.source.subscribe((input) => this.show(input));
    this.scale.on('resize', () => this.fitCamera(true));
    this.events.once('shutdown', () => this.unsubscribe?.());
  }

  /** Новое состояние: первый раз — сразу, дальше — плавный переход от того, что на экране. */
  show(target: TowerInput): void {
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
      duration: TWEEN_MS,
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
    this.model = buildTower(input);
    this.dom.apply(this.model, animate);
    this.fitCamera(!animate);
  }

  update(_time: number, delta: number): void {
    this.fitCamera(false, delta);
  }

  /** Рамка башни (от звезды до Мглы) по центру свободной части экрана. */
  private fitCamera(snap: boolean, delta = 16): void {
    const m = this.model;
    if (!m) return;
    const { width, height } = this.scale;
    const ins = this.options.insets?.() ?? { top: 0, right: 0, bottom: 0, left: 0 };
    const pad = 12;
    const vw = Math.max(80, width - ins.left - ins.right - 2 * pad);
    const vh = Math.max(80, height - ins.top - ins.bottom - 2 * pad);
    const b = m.bounds;
    const zoom = Phaser.Math.Clamp(Math.min(vw / b.w, vh / b.h), ZOOM_MIN, ZOOM_MAX);
    // Центр свободной области смещён от центра экрана на разницу отступов
    const dx = (ins.left - ins.right) / 2;
    const dy = (ins.top - ins.bottom) / 2;
    const x = b.x + b.w / 2 - dx / zoom;
    const y = b.y + b.h / 2 - dy / zoom;

    const c = this.cam;
    if (snap || this.reduced || !c.ready) {
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

  /** Сколько деталей в разметке и последний ход перехода — для отладки из консоли. */
  debug(): { parts: number; groups: string[]; appearMs: number } {
    return {
      parts: this.dom.count(),
      groups: this.model?.groups.map((g) => g.id) ?? [],
      appearMs: APPEAR_MS,
    };
  }
}
