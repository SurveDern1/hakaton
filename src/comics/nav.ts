// Где читатель в комиксе: страница и сколько кадров на ней уже проявилось.
// «Дальше» сначала дорисовывает страницу, потом листает; «назад» открывает прошлую страницу целиком.

export type NavStep = 'reveal' | 'page' | 'end' | 'none';

export class ComicNav {
  page = 0;
  /** Сколько кадров текущей страницы проявилось. */
  shown = 0;

  constructor(private counts: number[]) {}

  get pages(): number {
    return this.counts.length;
  }

  get isLast(): boolean {
    return this.page >= this.counts.length - 1;
  }

  get complete(): boolean {
    return this.shown >= (this.counts[this.page] ?? 0);
  }

  /** Касание «дальше»: дорисовать страницу, иначе следующая страница, иначе конец. */
  next(): NavStep {
    if (!this.complete) {
      this.shown = this.counts[this.page] ?? 0;
      return 'reveal';
    }
    return this.turn(1);
  }

  back(): NavStep {
    return this.turn(-1);
  }

  /** Перелистнуть без дорисовки (жест пальцем). */
  turn(dir: 1 | -1): NavStep {
    const to = this.page + dir;
    if (to < 0) return 'none';
    if (to >= this.counts.length) return dir > 0 ? 'end' : 'none';
    this.page = to;
    this.shown = dir > 0 ? 0 : (this.counts[to] ?? 0);
    return 'page';
  }

  /** Проявить ещё один кадр; false — страница уже целиком. */
  revealOne(): boolean {
    if (this.complete) return false;
    this.shown += 1;
    return true;
  }
}
