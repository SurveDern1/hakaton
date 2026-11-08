// Комиксы пролога и эпилогов: данные из data/comics.json, разбор сетки страницы, выбор эпилога
// по концовке и проверка файла. Без DOM — просмотрщик в viewer.ts.
import file from '../../data/comics.json';

/** Реплика в облачке. x, y — центр облачка в процентах кадра. */
export interface ComicBubble {
  who?: string;
  text: string;
  x: number;
  y: number;
  /** Куда смотрит хвостик; radio — без хвостика, рамка «эфира». */
  tail?: 'down' | 'left' | 'right' | 'none';
  kind?: 'speech' | 'radio';
}

/**
 * Текст, привязанный к месту на картинке, как его расставил художник. x, y, w — проценты картинки
 * (не кадра), поэтому текст едет вместе с камерой и при обрезке остаётся на своём облаке или плашке.
 * Заметка без y встаёт под предыдущую, той же ширины.
 */
export interface ComicNote {
  /** «\n» — перенос строки, как у художника (например, текст пирамидой в круге). */
  text: string;
  x?: number;
  y?: number;
  w?: number;
  /**
   * box — кремовая плашка, frame — контур без заливки, cloud — плашка, растворённая в светлом фоне,
   * plain — без плашки, radio — тёмная плашка с пунктирной рамкой (голос в эфире),
   * title — крупный заголовок листа без плашки, с тенью.
   */
  style?: 'box' | 'frame' | 'cloud' | 'plain' | 'radio' | 'title';
  /** Кто говорит: красная строка над репликой («Марта:»). */
  who?: string;
  /** Хвостик облачка снизу: где он стоит, в процентах ширины плашки. */
  tail?: number;
  align?: 'left' | 'center';
  /** Красный текст — для первой, ударной фразы. */
  accent?: boolean;
  /** Мельче обычного — когда место на картинке тесное. */
  small?: boolean;
  /** Множитель размера букв (0.85 — на 15 % мельче), когда текст впирается в края места на картинке. */
  scale?: number;
}

/** Сцена-заглушка, пока нет картинки (placeholder.ts). */
export interface ComicArt {
  scene: string;
  tone?: 'dawn' | 'night' | 'mist' | 'red';
}

export interface ComicPanel {
  /** Картинка из public/, путь без ведущего «/»: `comics/intro/01.webp`. Важнее, чем art. */
  image?: string;
  art?: ComicArt;
  alt?: string;
  caption?: string;
  captionAt?: 'top' | 'bottom';
  bubbles?: ComicBubble[];
  /** Звукоподражание крупными буквами поверх кадра. */
  sfx?: string;
  /** Крупная надпись внизу кадра — для заглавных кадров. */
  title?: string;
  /** Медленный наезд камеры по кадру. */
  move?: 'in' | 'out' | 'left' | 'right' | 'up' | 'down' | 'none';
  /** object-position картинки, например `50% 20%`. */
  focus?: string;
  /** Размер картинки в пикселях [ширина, высота]; нужен для notes и полностраничных листов. */
  size?: [number, number];
  /** Тексты на местах из макета художника. */
  notes?: ComicNote[];
  /** Точка, к которой едет камера (transform-origin), например `50% 0%` — край с текстом не уходит из кадра. */
  origin?: string;
}

export interface ComicPage {
  /** Раскладка кадров буквами, ряды через «/»: `a`, `a/b`, `ab/cc`, `ab/cb`. Буквы — кадры по порядку. */
  grid?: string;
  /** Доли высоты рядов, по умолчанию поровну. */
  rows?: number[];
  /** Лист — одна картинка во весь лист, без полей и рамки (как сверстал художник). */
  bleed?: boolean;
  panels: ComicPanel[];
}

export interface Comic {
  id: string;
  title: string;
  /** Подпись кнопки на последней странице. */
  finish?: string;
  pages: ComicPage[];
}

export interface ComicsFile {
  version: number;
  comics: Comic[];
}

export const comicsFile = file as unknown as ComicsFile;

export function getComic(id: string, src: ComicsFile = comicsFile): Comic | null {
  return src.comics.find((c) => c.id === id) ?? null;
}

/** Эпилог концовки: `outro_<id>`, иначе общий `outro`, иначе нет. */
export function outroFor(endingId: string, src: ComicsFile = comicsFile): Comic | null {
  return getComic(`outro_${endingId}`, src) ?? getComic('outro', src);
}

const DEFAULT_GRID: Record<number, string> = { 1: 'a', 2: 'a/b', 3: 'aa/bc', 4: 'ab/cd' };

export interface PageGrid {
  /** Значение grid-template-areas. */
  areas: string;
  columns: number;
  /** Значение grid-template-rows. */
  rows: string;
  /** Имя области для каждого кадра по порядку. */
  names: string[];
}

/** Сетка страницы для CSS grid. Бросает ошибку на сетке, которая не сходится с кадрами. */
export function pageGrid(page: ComicPage): PageGrid {
  const n = page.panels.length;
  const grid = page.grid ?? DEFAULT_GRID[n] ?? Array.from({ length: n }, (_, i) => letter(i)).join('/');
  const rows = grid.split('/').map((r) => r.trim());
  const columns = rows[0]?.length ?? 0;
  if (!columns || rows.some((r) => r.length !== columns))
    throw new Error(`сетка «${grid}»: ряды разной длины`);
  const names: string[] = [];
  for (const ch of rows.join('')) {
    if (!/[a-z]/.test(ch)) throw new Error(`сетка «${grid}»: только латинские буквы`);
    if (!names.includes(ch)) names.push(ch);
  }
  if (names.length !== n) throw new Error(`сетка «${grid}»: ${names.length} областей, кадров ${n}`);
  names.forEach((ch, i) => {
    if (ch !== letter(i)) throw new Error(`сетка «${grid}»: буквы идут не по порядку (a, b, c…)`);
    if (!isRect(rows, ch)) throw new Error(`сетка «${grid}»: область ${ch} не прямоугольная`);
  });
  if (page.rows && page.rows.length !== rows.length)
    throw new Error(`сетка «${grid}»: rows на ${page.rows.length} ряда, а рядов ${rows.length}`);
  return {
    areas: rows.map((r) => `"${[...r].join(' ')}"`).join(' '),
    columns,
    rows: (page.rows ?? rows.map(() => 1)).map((f) => `minmax(0, ${f}fr)`).join(' '),
    names,
  };
}

const letter = (i: number) => String.fromCharCode(97 + i);

function isRect(rows: string[], ch: string): boolean {
  const cells: [number, number][] = [];
  rows.forEach((r, y) => {
    [...r].forEach((c, x) => {
      if (c === ch) cells.push([x, y]);
    });
  });
  const xs = cells.map((c) => c[0]);
  const ys = cells.map((c) => c[1]);
  const w = Math.max(...xs) - Math.min(...xs) + 1;
  const hgt = Math.max(...ys) - Math.min(...ys) + 1;
  return w * hgt === cells.length;
}

/** Ошибки файла комиксов: сетки, пустые страницы, координаты облачков, эпилоги для концовок. */
export function checkComics(src: ComicsFile, endingIds: string[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const c of src.comics) {
    if (ids.has(c.id)) errors.push(`повтор комикса ${c.id}`);
    ids.add(c.id);
    if (!c.pages.length) errors.push(`${c.id}: нет страниц`);
    c.pages.forEach((p, i) => {
      const at = `${c.id}, стр. ${i + 1}`;
      if (!p.panels.length) errors.push(`${at}: нет кадров`);
      if (p.bleed && (p.panels.length !== 1 || !p.panels[0]?.image || !p.panels[0]?.size))
        errors.push(`${at}: лист bleed — один кадр с image и size`);
      try {
        pageGrid(p);
      } catch (e) {
        errors.push(`${at}: ${(e as Error).message}`);
      }
      p.panels.forEach((panel, k) => {
        if (!panel.image && !panel.art) errors.push(`${at}, кадр ${k + 1}: нет ни image, ни art`);
        if (panel.image?.startsWith('/')) errors.push(`${at}, кадр ${k + 1}: путь картинки без ведущего «/»`);
        for (const b of panel.bubbles ?? []) {
          if (b.x < 0 || b.x > 100 || b.y < 0 || b.y > 100)
            errors.push(`${at}, кадр ${k + 1}: облачко вне 0–100`);
        }
        if (panel.notes?.length && !panel.size) errors.push(`${at}, кадр ${k + 1}: notes без size картинки`);
        panel.notes?.forEach((n, j) => {
          const where = `${at}, кадр ${k + 1}, текст ${j + 1}`;
          if (j === 0 && n.y === undefined) errors.push(`${where}: у первого текста нет y`);
          for (const v of [n.x, n.y, n.w, n.tail])
            if (v !== undefined && (v < 0 || v > 100)) errors.push(`${where}: координата вне 0–100`);
          if (!n.text.trim()) errors.push(`${where}: пустой текст`);
        });
      });
    });
  }
  if (!ids.has('intro')) errors.push('нет пролога intro');
  for (const e of endingIds) if (!outroFor(e, src)) errors.push(`нет эпилога для концовки ${e}`);
  return errors;
}
