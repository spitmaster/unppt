/**
 * 用 clip-path 做"逐渐露出"类效果的公共工具（动画效果、显现滤镜、页面切换共用）。
 * polygon() 用百分比（相对元素外框），关键帧之间点数不变才能平滑插值。
 */

const pct = (v: number) => `${Math.round(v * 100) / 100}%`;

/** 多边形，点是 [x%, y%] */
export function polygon(points: [number, number][]): string {
  return `polygon(${points.map(([x, y]) => `${pct(x)} ${pct(y)}`).join(',')})`;
}

/**
 * n 条平行的带，每条从起点露出 p（0~1）。horizontal 为真时是横条（沿 y 方向露出）。
 * 各条之间沿一条边用零宽的线连起来，组成一个多边形。
 */
export function bands(n: number, p: number, horizontal: boolean): string {
  const pts: [number, number][] = [];
  const h = 100 / n;
  for (let i = 0; i < n; i++) {
    const a = i * h, b = a + h * p;
    pts.push([0, a], [100, a], [100, b], [0, b]);
  }
  pts.push([0, 0]);
  return polygon(horizontal ? pts : pts.map(([x, y]) => [y, x]));
}

/** 轮子：从 12 点方向顺时针，n 个扇形各张开 p（0~1）个 360/n 度 */
export function wedges(n: number, p: number): string {
  const pts: [number, number][] = [];
  const M = 8;
  for (let k = 0; k < n; k++) {
    const a0 = (Math.PI * 2 * k) / n, span = (Math.PI * 2 * p) / n;
    pts.push([50, 50]);
    for (let j = 0; j <= M; j++) {
      const a = a0 + (span * j) / M;
      pts.push([50 + 75 * Math.sin(a), 50 - 75 * Math.cos(a)]);
    }
  }
  return polygon(pts);
}

/** 关键帧序列：f(进度) 在 0~1 之间取 steps+1 个点 */
export function sample(steps: number, f: (p: number) => Keyframe): Keyframe[] {
  return Array.from({ length: steps + 1 }, (_, i) => ({ ...f(i / steps), offset: i / steps }));
}

/** [左, 上, 右, 下]，单位 % */
export type Rect = [number, number, number, number];

/**
 * 一组矩形拼成一个多边形：矩形之间用来回走两遍的零宽连线串起来（面积为零，不影响填充）。
 * 矩形个数固定时，不同进度的结果点数相同，可以插值
 */
export function rectsPolygon(rects: Rect[]): string {
  if (!rects.length) return 'polygon(0 0,0 0,0 0)';
  const pts: [number, number][] = [];
  for (const [x0, y0, x1, y1] of rects) pts.push([x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]);
  for (let i = rects.length - 2; i >= 0; i--) pts.push([rects[i][0], rects[i][1]]);
  return polygon(pts);
}
