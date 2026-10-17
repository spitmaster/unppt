/**
 * 三维柱形图、三维条形图（c:bar3DChart，直角坐标轴的斜投影）：背景墙和侧墙（地板）上的网格线、立方体的柱子。
 * PowerPoint 实测（charts-3d 的簇状柱形、堆积柱形、簇状条形三张导出图，rotX 15°、rotY 20°；从柱子三个面的颜色反推几何）：
 *   - 正面不缩短，深度方向在屏幕上是 (sin rotY, −sin rotX) × 深度；柱子深度 = 0.97 × 柱宽 × 深度%（柱宽按最终的正面算），
 *     墙的深度 = 柱子深度 × (1 + 间隙深度% / 2)，柱子贴着正面；数值轴不加 5% 余量；
 *   - 在平面布局的绘图区里：背景墙上沿 = 上边 + 6、背景墙右边 = 右边 − 4.1，正面左边 = 左边 + 3.1 + 0.39·dx，
 *     正面底边 = 下边 − 3.6 − 0.54·|dy|（深度和正面宽高互相依赖，联立解出）；三张图的正面位置、宽高误差都在 1 像素以内；
 *   - 坐标轴标签都在正面往观众方向移 0.46 个墙深：下方标签左移 0.46·dx、下移 0.46·|dy|，左侧标签下移 0.46·|dy|
 *     （左侧标签的横向位置和平面布局一样）；
 *   - 立方体和网格线的画法见 box3d.ts。
 * 条形图按同样的系数横过来画（分类在左、数值在下，网格线是地板上的斜线 + 背景墙上的竖线）。
 * 系列沿深度排的柱形图见 cat3d-depth.ts；其它三维图（折线、面积、透视投影）还按平面画。
 */
import { css, type ColorContext, type Rgba } from '../model/color';
import { n2 } from '../common/svg';
import { attr, child, type XEl } from '../io/xml';
import { barCuboid, columnCuboid, wallGridPath } from './box3d';
import { cpart, label, textStyle } from './draw';
import { catBand, catCenter, PAD, RIGHT_LABEL_PAD, SIDE_LABEL_PAD, sideAnchor, sideGap, topForLabel, valBand, valCenter, type TextWidth } from './layout';
import type { AxisMaker, Plot, Rect, TextStyle, View3D } from './model';

export interface Cat3DEnv { colors: ColorContext; part: string; baseText: TextStyle; makeAxis: AxisMaker; tw: TextWidth; w: number; view: View3D }

/** 实测常数（像素）：柱子深度系数、背景墙上沿和右边的内缩、正面左边和底边的偏移、标签往观众方向移的墙深比例 */
const BAR_DEPTH = 0.97, TOP_GAP = 6, RIGHT_GAP = 4.1, LEFT_A = 3.1, LEFT_B = 0.39, BOTTOM_A = 3.6, BOTTOM_B = 0.54, LABEL_Z = 0.46;

/** 能按三维柱形 / 条形图画的：只有一个 bar3DChart、簇状或堆积、直角坐标轴 */
export const isColumn3D = (plots: Plot[], view?: View3D) =>
  !!view && plots.length === 1 && plots[0].is3D && plots[0].kind === 'bar' && plots[0].grouping !== 'standard' && view.rAngAx;

export function renderColumn3D(p: Plot, valAx: XEl | undefined, catAx: XEl | undefined, area: Rect, env: Cat3DEnv, out: string[]): void {
  const { colors, baseText, makeAxis, tw, w, view } = env;
  const hz = p.horizontal;
  const cats = p.series[0]?.cats ?? [];
  const nCat = Math.max(1, ...p.series.map((s) => s.vals.length));
  const nSer = Math.max(1, p.series.length);
  const stacked = p.grouping === 'stacked' || p.grouping === 'percentStacked';
  const slots = stacked ? 1 : nSer;
  // 数值范围（堆积按分类求和），不加余量
  let vmin = 0, vmax = 0;
  for (let i = 0; i < nCat; i++) {
    let pos = 0, neg = 0;
    for (const s of p.series) {
      const v = s.vals[i] ?? 0;
      if (stacked) { if (v >= 0) pos += v; else neg += v; } else { vmax = Math.max(vmax, v); vmin = Math.min(vmin, v); }
    }
    if (stacked) { vmax = Math.max(vmax, pos); vmin = Math.min(vmin, neg); }
  }
  if (p.grouping === 'percentStacked') { vmax = 1; vmin = Math.min(0, vmin); }
  const catStyle = textStyle(child(catAx, 'c:txPr'), colors, baseText);
  const catDeleted = attr(child(catAx, 'c:delete'), 'val') === '1';
  const edge = (l: number) => (l === PAD ? SIDE_LABEL_PAD : l);
  const maxW = (ls: string[], st: TextStyle) => Math.max(0, ...ls.map((t) => tw(t, st.size, st.font)));
  // 平面布局（和分类轴图同一套实测间距），按数值轴长度两遍定刻度
  const place = (len?: number) => {
    const A = makeAxis(valAx, vmin, vmax, { pct: p.grouping === 'percentStacked', margin: 0, length: len, horizontal: hz });
    let { left, top, right, bottom } = area;
    if (!hz) {
      if (!A.deleted) { left = edge(left) + maxW(A.labels, A.style) + sideGap(A.style.size); top = Math.max(top, topForLabel(A.style.size)); }
      if (!catDeleted) bottom -= catBand(catStyle.size);
    } else {
      if (!catDeleted) left = edge(left) + maxW(cats, catStyle) + sideGap(catStyle.size);
      if (!A.deleted) { bottom -= valBand(A.style.size); right = Math.min(right, w - RIGHT_LABEL_PAD - tw(A.labels[A.labels.length - 1] ?? '', A.style.size, A.style.font) / 2); }
    }
    return { A, left, top, right, bottom };
  };
  const first = place();
  const { A, left, top, right, bottom } = place(hz ? first.right - first.left : first.bottom - first.top);
  // 深度和分类方向的长度成正比：墙深 = 每个分类宽 × perBand
  const rx = Math.sin((view.rotY * Math.PI) / 180), ry = Math.sin((view.rotX * Math.PI) / 180);
  const perBand = ((1 + p.gapDepth / 200) * BAR_DEPTH * (view.depthPercent / 100)) / (slots + p.gapWidth / 100);
  // 分类方向的长度 L 和墙深联立：柱形图 W·(1 + 1.39·dx/W) = 可用宽，条形图 H·(1 + 1.54·|dy|/H) = 可用高
  const catLen = hz
    ? (bottom - top - TOP_GAP - BOTTOM_A) / (1 + (1 + BOTTOM_B) * ry * perBand / nCat)
    : (right - left - RIGHT_GAP - LEFT_A) / (1 + (1 + LEFT_B) * rx * perBand / nCat);
  const wallDepth = Math.max(0, catLen / nCat * perBand);
  const dx = wallDepth * rx, dy = -wallDepth * ry;
  const fl = left + LEFT_A + LEFT_B * dx, fb = bottom - BOTTOM_A - BOTTOM_B * -dy;
  const fr = right - RIGHT_GAP - dx, ft = top + TOP_GAP - dy;
  const fw = Math.max(1, fr - fl), fh = Math.max(1, fb - ft);
  const band = (hz ? fh : fw) / nCat;
  const thick = band / (slots + p.gapWidth / 100);
  const barDepth = thick * BAR_DEPTH * view.depthPercent / 100;
  const bdx = barDepth * rx, bdy = -barDepth * ry;
  // 数值 -> 正面上的坐标（柱形图是 y，条形图是 x）
  const vp = (v: number) => (hz ? fl + A.pos(v) * fw : fb - A.pos(v) * fh);
  const g = A.grid;
  if (g?.color) {
    const d = wallGridPath(A.ticks.map(vp), hz, fl, fr, ft, fb, dx, dy);
    out.push(`<path d="${d}" fill="none" stroke="${css(g.color)}" stroke-width="${n2(g.width)}"/>`);
  }
  const lx = LABEL_Z * dx, ly = LABEL_Z * -dy;
  const leftLabel = (t: string, y: number, st: TextStyle) => label(t, left - sideAnchor(st.size), y + ly, st, 'end');
  if (!A.deleted) {
    A.ticks.forEach((t, i) => out.push(hz ? label(A.labels[i], vp(t) - lx, fb + valCenter(A.style.size) + ly, A.style) : leftLabel(A.labels[i], vp(t), A.style)));
  }
  if (!catDeleted) {
    cats.forEach((c, i) => out.push(hz ? leftLabel(c, fb - (i + 0.5) * band, catStyle) : label(c, fl + (i + 0.5) * band - lx, fb + catCenter(catStyle.size) + ly, catStyle)));
  }
  // 柱子
  const base = new Array(nCat).fill(0), neg = new Array(nCat).fill(0);
  const totals = new Array(nCat).fill(0).map((_, i) => p.series.reduce((a, s) => a + Math.abs(s.vals[i] ?? 0), 0) || 1);
  const boxes: { key: string; c0: number; v1: number; v2: number; color: Rgba }[] = [];
  p.series.forEach((s, si) => {
    for (let i = 0; i < nCat; i++) {
      let v = s.vals[i];
      if (v === null || v === undefined) continue;
      if (p.grouping === 'percentStacked') v = v / totals[i];
      let a = 0, b = v;
      if (stacked) { const b0 = v >= 0 ? base[i] : neg[i]; a = b0; b = b0 + v; if (v >= 0) base[i] = b; else neg[i] = b; }
      const color = s.pointFills.get(i) ?? s.fill;
      if (!color) continue;
      // 分类方向上离正面左边（条形图：底边）的距离
      const c0 = i * band + (band - thick * slots) / 2 + (stacked ? 0 : si * thick);
      boxes.push({ key: `${s.index}x${i}`, c0, v1: vp(Math.min(a, b)), v2: vp(Math.max(a, b)), color });
    }
  });
  // 柱形图从左往右画（右侧面被右边的挡住），条形图从下往上画（顶面被上面的挡住）
  boxes.sort((m, n) => m.c0 - n.c0);
  for (const bx of boxes) {
    out.push(cpart(bx.key, hz
      ? barCuboid(bx.v1, bx.v2, fb - bx.c0 - thick, thick, bdx, bdy, bx.color)
      : columnCuboid(fl + bx.c0, bx.v2, bx.v1, thick, bdx, bdy, bx.color)));
  }
}
