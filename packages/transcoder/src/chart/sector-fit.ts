/**
 * 饼图"最佳位置"的标签能不能放进扇区：标签的每一行是一个矩形（各行居中对齐），四角都要在扇区里（圆内、两条半径之间）。
 * 先沿角平分线从外往里找，第一个放得下的位置就是标签中心；角平分线上放不下时在整个扇区里找，取所有放得下的位置的平均；
 * 哪里都放不下时 PowerPoint 把标签放到饼外。规则和依据见 SPEC 第 7 节（PowerPoint 探针：单个扇区 3%~40%、角平分线朝右 / 右下 / 下，
 * 宽标签、三行窄标签、40 个字的长标签，再加 6 块扇区、24 磅两三行标签的饼图——左右两块 18% 的扇区标签一个放外面、一个折行放里面）
 */

/** 扇区：圆心在原点，半径 r，从角 a1 顺时针到 a2（弧度，0 朝右，y 向下） */
export interface Sector { r: number; a1: number; a2: number }

/** 实测：每行文字左右各算 1.5 磅（标签框的内边距是 3 磅，按 3 磅算时窄扇区里折行后放得下的标签会判成放不下）；上下不加 */
export const LINE_PAD = 1.5 * 96 / 72;
/** 行的角可以超出饼边 1 磅（6 块扇区的 24 磅标签：可放的位置只有一小片，饼的半径差 0.6 磅就判成放不下；探针里 0~1.5 磅结果都一样） */
const ARC_SLACK = 1 * 96 / 72;
const TAU = Math.PI * 2;
/** 整个扇区里找时角度、半径的步长 */
const ANGLE_STEP = Math.PI / 360;
const D_STEP = 0.5;

type Rect = [number, number, number, number];

function inWedge(x: number, y: number, s: Sector): boolean {
  let a = Math.atan2(y, x);
  while (a < s.a1) a += TAU;
  while (a > s.a1 + TAU) a -= TAU;
  return a <= s.a2 + 1e-9;
}

function fitsAt(rects: Rect[], cx: number, cy: number, s: Sector): boolean {
  const lim = (s.r + ARC_SLACK) ** 2;
  for (const [x0, y0, x1, y1] of rects) {
    for (const x of [cx + x0, cx + x1]) {
      for (const y of [cy + y0, cy + y1]) if (x * x + y * y > lim || !inWedge(x, y, s)) return false;
    }
  }
  return true;
}

/** 各行的矩形（相对标签中心）：widths / heights 是各行文字的宽、高（像素） */
function lineRects(widths: number[], heights: number[]): Rect[] {
  const H = heights.reduce((a, b) => a + b, 0);
  let y = -H / 2;
  return widths.map((w, k) => { const r: Rect = [-w / 2 - LINE_PAD, y, w / 2 + LINE_PAD, y + heights[k]]; y += heights[k]; return r; });
}

/** 标签中心（相对圆心）；放不下时 undefined */
export function placeInSector(widths: number[], heights: number[], s: Sector): { x: number; y: number } | undefined {
  const rects = lineRects(widths, heights);
  const mid = (s.a1 + s.a2) / 2, c = Math.cos(mid), sn = Math.sin(mid);
  for (let d = s.r; d > 0; d -= 0.5) if (fitsAt(rects, d * c, d * sn, s)) return { x: d * c, y: d * sn };
  let n = 0, sx = 0, sy = 0;
  for (let a = s.a1; a <= s.a2; a += ANGLE_STEP) {
    const ca = Math.cos(a), sa = Math.sin(a);
    for (let d = D_STEP; d < s.r; d += D_STEP) {
      if (fitsAt(rects, d * ca, d * sa, s)) { n++; sx += d * ca; sy += d * sa; }
    }
  }
  return n ? { x: sx / n, y: sy / n } : undefined;
}
