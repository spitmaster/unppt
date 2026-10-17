/**
 * 三维柱形图里系列沿深度排的一种（c:bar3DChart、grouping="standard"、直角坐标轴）：每个系列占深度方向的一排。
 * PowerPoint 实测（COM 生成 19 种尺寸、旋转角、深度、间隙深度、高度的变体，用导出图上柱子各个面的颜色反推）：
 *   - 每个系列占一个深度槽：槽深 = 分类宽 × 深度%，柱子深度 = 槽深 / (1 + 间隙深度%)，柱子在槽里居中；
 *     墙深 D = 系列数 × 槽深；柱宽 = 分类宽 / (1 + 间隙宽度%)；
 *   - 内部区域是平面布局的绘图区（左边留数值标签，下面留分类标签），rotY < 30° 时右边再留出系列标签（标签宽 + 7）；
 *     正面左边 = 内部左边 + 2，整体（含深度）横向占满到内部右边；
 *   - 记 r = 系列数 / 分类数 × 深度%、k = 1 + r·sin rotY：W·k = 内部右边 − 正面左边；
 *     自动缩放（没写 hPercent）时正面高 H = 0.745 × 内部高 / k——纵向也用 rotY，和 rotX 无关；
 *     写了 hPercent 时 H = hPercent × 系列数 / 分类数 × W（一个样例）；整体（含深度）在内部区域里上下居中、再往下 1；
 *   - 刻度疏密按 H·k 当轴长算（H 本身偏小，PowerPoint 的刻度比按 H 算的密）；
 *   - 数值标签和平面布局一样在内部左边外侧、对着正面上的刻度；分类标签在正面底边下方（和平面布局一样）；
 *     系列标签左对齐，在地板右边缘每个槽的中点往右 1.375 倍字号。
 * 和 PowerPoint 导出图对照：正面左边、底边、宽、高误差在 2 像素以内（默认旋转）。
 * 立方体、网格线的画法和簇状一样（box3d.ts）。
 */
import { css, type ColorContext, type Rgba } from '../model/color';
import { n2 } from '../common/svg';
import { attr, child, type XEl } from '../io/xml';
import { columnCuboid, wallGridPath } from './box3d';
import { cpart, label, textStyle } from './draw';
import { catBand, catCenter, PAD, SIDE_LABEL_PAD, sideAnchor, sideGap, topForLabel, type TextWidth } from './layout';
import type { AxisMaker, Plot, Rect, TextStyle, View3D } from './model';

export interface Depth3DEnv { colors: ColorContext; baseText: TextStyle; makeAxis: AxisMaker; tw: TextWidth; view: View3D }

/** 实测常数（像素）：正面左边的偏移、高度系数、整体往下的偏移、系列标签的位置和右边留的空 */
const FL_SHIFT = 2, HEIGHT_K = 0.745, V_SHIFT = 1;
const serGap = (s: number) => 1.375 * s;
const SER_BAND_GAP = 7;

/** 能按"系列沿深度排"画的：一个 bar3DChart、柱形、标准分组、直角坐标轴 */
export const isColumnDepth3D = (plots: Plot[], view?: View3D) =>
  !!view && view.rAngAx && plots.length === 1 && plots[0].is3D && plots[0].kind === 'bar' && plots[0].grouping === 'standard' && !plots[0].horizontal;

export function renderColumnDepth3D(p: Plot, valAx: XEl | undefined, catAx: XEl | undefined, serAx: XEl | undefined, area: Rect, env: Depth3DEnv, out: string[]): void {
  const { colors, baseText, makeAxis, tw, view } = env;
  const cats = p.series[0]?.cats ?? [];
  const nCat = Math.max(1, ...p.series.map((s) => s.vals.length));
  const nSer = Math.max(1, p.series.length);
  let vmin = 0, vmax = 0;
  for (const s of p.series) for (const v of s.vals) if (v !== null && v !== undefined) { vmax = Math.max(vmax, v); vmin = Math.min(vmin, v); }
  const catStyle = textStyle(child(catAx, 'c:txPr'), colors, baseText);
  const serStyle = textStyle(child(serAx, 'c:txPr'), colors, baseText);
  const catDeleted = attr(child(catAx, 'c:delete'), 'val') === '1';
  const serDeleted = !serAx || attr(child(serAx, 'c:delete'), 'val') === '1';
  const names = p.series.map((s) => s.name);
  const maxW = (ls: string[], st: TextStyle) => Math.max(0, ...ls.map((t) => tw(t, st.size, st.font)));
  const sinY = Math.sin((view.rotY * Math.PI) / 180), sinX = Math.sin((view.rotX * Math.PI) / 180);
  const r = (nSer / nCat) * (view.depthPercent / 100);
  const k = 1 + r * sinY;
  // 内部区域（和平面布局同一套间距），按数值轴长度两遍定刻度
  const place = (len?: number) => {
    const A = makeAxis(valAx, vmin, vmax, { margin: 0, length: len });
    let { left, top, right, bottom } = area;
    if (!A.deleted) { left = (left === PAD ? SIDE_LABEL_PAD : left) + maxW(A.labels, A.style) + sideGap(A.style.size); top = Math.max(top, topForLabel(A.style.size)); }
    if (!catDeleted) bottom -= catBand(catStyle.size);
    if (!serDeleted && view.rotY < 30) right -= maxW(names, serStyle) + SER_BAND_GAP;
    const W = Math.max(1, (right - left - FL_SHIFT) / k);
    const H = Math.max(1, view.autoScale ? (HEIGHT_K * (bottom - top)) / k : (view.hPercent / 100) * (nSer / nCat) * W);
    return { A, left, top, bottom, W, H };
  };
  const first = place();
  const { A, left, top, bottom, W, H } = place(first.H * k);
  const D = r * W;
  const S = D / nSer, b = S / (1 + p.gapDepth / 100);
  const fl = left + FL_SHIFT;
  const fb = (top + bottom) / 2 + V_SHIFT + (H + D * sinX) / 2;
  const fr = fl + W, ft = fb - H;
  const dx = D * sinY, dy = -D * sinX;
  const band = W / nCat, thick = band / (1 + p.gapWidth / 100);
  const vp = (v: number) => fb - A.pos(v) * H;
  if (A.grid?.color) out.push(`<path d="${wallGridPath(A.ticks.map(vp), false, fl, fr, ft, fb, dx, dy)}" fill="none" stroke="${css(A.grid.color)}" stroke-width="${n2(A.grid.width)}"/>`);
  if (!A.deleted) A.ticks.forEach((t, i) => out.push(label(A.labels[i], left - sideAnchor(A.style.size), vp(t), A.style, 'end')));
  if (!catDeleted) cats.forEach((c, i) => out.push(label(c, fl + (i + 0.5) * band, fb + catCenter(catStyle.size), catStyle)));
  if (!serDeleted) {
    names.forEach((nm, j) => {
      const z = (j + 0.5) * S;
      out.push(label(nm, fr + z * sinY + serGap(serStyle.size), fb - z * sinX - 1, serStyle, 'start'));
    });
  }
  // 柱子：后排先画，同一排从左往右（右侧面被右边的挡住）
  const zero = vp(Math.max(A.lo, Math.min(A.hi, 0)));
  for (let j = nSer - 1; j >= 0; j--) {
    const s = p.series[j];
    const z = j * S + (S - b) / 2;
    const ox = z * sinY, oy = -z * sinX;
    for (let i = 0; i < nCat; i++) {
      const v = s.vals[i];
      if (v === null || v === undefined) continue;
      const color: Rgba | undefined = s.pointFills.get(i) ?? s.fill;
      if (!color) continue;
      const y = vp(Math.max(A.lo, Math.min(A.hi, v)));
      const x = fl + i * band + (band - thick) / 2;
      out.push(cpart(`${s.index}x${i}`, columnCuboid(x + ox, Math.min(y, zero) + oy, Math.max(y, zero) + oy, thick, b * sinY, -b * sinX, color)));
    }
  }
}
