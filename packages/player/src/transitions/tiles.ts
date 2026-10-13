/**
 * 图块类切换（溶解、随机线条、棋盘、百叶窗、梳理）的公共工具：每帧把露出的矩形拼成一个 clip-path 多边形。
 * 矩形之间用来回走两遍的零宽连线串起来（面积为零，不影响填充），坐标用百分比。
 */
import { driven } from './drive';

/** [左, 上, 右, 下]，单位 %（相对页面） */
export type Rect = [number, number, number, number];

const f = (v: number) => `${Math.round(v * 100) / 100}%`;

export function rectsPolygon(rects: Rect[]): string {
  if (!rects.length) return 'polygon(0 0,0 0,0 0)';
  const pts: string[] = [];
  for (const [x0, y0, x1, y1] of rects) pts.push(`${f(x0)} ${f(y0)}`, `${f(x1)} ${f(y0)}`, `${f(x1)} ${f(y1)}`, `${f(x0)} ${f(y1)}`, `${f(x0)} ${f(y0)}`);
  for (let i = rects.length - 2; i >= 0; i--) pts.push(`${f(rects[i][0])} ${f(rects[i][1])}`);
  return `polygon(${pts.join(',')})`;
}

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
