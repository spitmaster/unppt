/**
 * 图块类切换（溶解、随机线条、棋盘、百叶窗、梳理）的公共工具：每帧把露出的矩形拼成一个 clip-path 多边形
 * （拼法见 ../clip.ts 的 rectsPolygon），坐标用百分比。
 */
import { rectsPolygon, type Rect } from '../clip';
import { driven } from './drive';

export type { Rect } from '../clip';

/** 同一行里相邻的格子合成一个矩形（少画很多点）：on[r][c] 为真的格子，格子大小 cw x ch（%） */
export function gridRects(on: (r: number, c: number) => boolean, rows: number, cols: number, cw: number, ch: number): Rect[] {
  const out: Rect[] = [];
  for (let r = 0; r < rows; r++) {
    let start = -1;
    for (let c = 0; c <= cols; c++) {
      const v = c < cols && on(r, c);
      if (v && start < 0) start = c;
      if (!v && start >= 0) {
        out.push([start * cw, r * ch, c * cw, (r + 1) * ch]);
        start = -1;
      }
    }
  }
  return out;
}

/** 固定种子的伪随机数（每次播放的图案一样，方便对照和测试） */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 0..n-1 的随机排列 */
export function shuffled(n: number, seed: number): number[] {
  const rnd = seeded(seed);
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 逐帧设置 el 的裁剪：rects(u) 返回此刻露出新页的矩形 */
export function tileTransition(el: HTMLElement, dur: number, rects: (u: number) => Rect[]): Animation {
  return driven(el, dur, (u) => { el.style.clipPath = rectsPolygon(rects(u)); }, () => { el.style.clipPath = ''; });
}
