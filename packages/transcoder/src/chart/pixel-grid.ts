/**
 * 整像素对齐（实测，见 SPEC 第 7 节）：PowerPoint 画图表里横平竖直的东西（网格线、坐标轴线、刻度线、柱子）时不做抗锯齿，
 * 位置按浮点算好，光栅化时像素中心落在图形里的像素才画：1 像素宽的线落在 floor(y) 那一行，矩形的边落在 round(x)。
 * 按幻灯片坐标（1 像素 = 9525 EMU）对齐，所以要知道图表在幻灯片上的位置；不知道时不对齐。
 */
export interface PixelGrid {
  /** 矩形的边（图表内的坐标）对齐到幻灯片的像素边界 */
  x(v: number): number;
  y(v: number): number;
  /** 宽 w 的细线（竖线 axis 给 x，横线给 y）对齐后中心的位置：线的两边各自对齐到像素边界 */
  line(axis: 'x' | 'y', v: number, w: number): number;
}

export const NO_GRID: PixelGrid = { x: (v) => v, y: (v) => v, line: (_a, v) => v };

/** 图表里的 (x, y) 在幻灯片上是 (ox + sx·x, oy + sy·y)（在组合里会缩放） */
export function pixelGrid(ox: number, oy: number, sx = 1, sy = 1): PixelGrid {
  const snap = (o: number, s: number, v: number) => (Math.round(o + s * v) - o) / s;
  return {
    x: (v) => snap(ox, sx, v),
    y: (v) => snap(oy, sy, v),
    line(axis, v, w) {
      const [o, s] = axis === 'x' ? [ox, sx] : [oy, sy];
      // 线宽至少 1 像素（细线也占一整行像素）
      const half = Math.max(w * s, 1) / 2;
      const a = Math.round(o + s * v - half), b = Math.max(a + 1, Math.round(o + s * v + half));
      return ((a + b) / 2 - o) / s;
    },
  };
}
