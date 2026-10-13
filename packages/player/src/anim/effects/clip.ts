/**
 * 用 clip-path 做"逐渐露出"类效果的公共工具。
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
