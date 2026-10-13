/**
 * 三维柱形图、三维条形图（c:bar3DChart，直角坐标轴的斜投影）：背景墙和侧墙（地板）上的网格线、立方体的柱子。
 * PowerPoint 实测（charts-3d 导出图，rotX 15°、rotY 20°、深度 100%、间隙深度 150%）：
 *   - 正面不缩短，深度方向在屏幕上是 (sin rotY, −sin rotX) × 深度；柱子深度 = 柱宽 × 深度%，
 *     墙的深度 = 柱子深度 × (1 + 间隙深度% / 2)，柱子贴着正面；
 *   - 数值轴不加 5% 余量；背景墙右上角比平面布局的绘图区往里 (0.28·dx, 0.42·|dy|)，正面底边比平面布局高 0.77·|dy|，
 *     正面左边右移 0.53·dx；
 *   - 左侧（柱形图的数值、条形图的分类）标签再往左让出 0.53·dx、往下 0.3·|dy|，下方标签往下 0.4·|dy|；
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
  const maxW = (ls: string[], s: number) => Math.max(0, ...ls.map((t) => tw(t, s)));
  // 平面布局（和分类轴图同一套实测间距），按数值轴长度两遍定刻度
  const place = (len?: number) => {
    const A = makeAxis(valAx, vmin, vmax, { pct: p.grouping === 'percentStacked', margin: 0, length: len, horizontal: hz });
    let { left, top, right, bottom } = area;
    if (!hz) {
      if (!A.deleted) { left = edge(left) + maxW(A.labels, A.style.size) + sideGap(A.style.size); top = Math.max(top, topForLabel(A.style.size)); }
      if (!catDeleted) bottom -= catBand(catStyle.size);
    } else {
      if (!catDeleted) left = edge(left) + maxW(cats, catStyle.size) + sideGap(catStyle.size);
      if (!A.deleted) { bottom -= valBand(A.style.size); right = Math.min(right, w - RIGHT_LABEL_PAD - tw(A.labels[A.labels.length - 1] ?? '', A.style.size) / 2); }
    }
    return { A, left, top, right, bottom };
  };
  const first = place();
  const { A, left, top, right, bottom } = place(hz ? first.right - first.left : first.bottom - first.top);
  // 深度：柱子粗细由分类方向的长度和间隙宽度决定
  const thick0 = ((hz ? bottom - top : right - left) / nCat) / (slots + p.gapWidth / 100);
  const rx = Math.sin((view.rotY * Math.PI) / 180), ry = Math.sin((view.rotX * Math.PI) / 180);
  const barDepth = thick0 * view.depthPercent / 100;
  const wallDepth = barDepth * (1 + p.gapDepth / 200);
  const dx = wallDepth * rx, dy = -wallDepth * ry;
  const bdx = barDepth * rx, bdy = -barDepth * ry;
  // 正面：背景墙右上角往里收一点、正面左下角往里（实测）
  const backRight = right - 0.28 * dx, backTop = top + 0.42 * -dy;
  const fl = left + 0.53 * dx, fb = bottom - 0.77 * -dy;
  const fr = backRight - dx, ft = backTop - dy;
  const fw = Math.max(1, fr - fl), fh = Math.max(1, fb - ft);
  const band = (hz ? fh : fw) / nCat;
  const thick = band / (slots + p.gapWidth / 100);
  // 数值 -> 正面上的坐标（柱形图是 y，条形图是 x）
  const vp = (v: number) => (hz ? fl + A.pos(v) * fw : fb - A.pos(v) * fh);
  const g = A.grid;
  if (g?.color) {
    const d = wallGridPath(A.ticks.map(vp), hz, fl, fr, ft, fb, dx, dy);
    out.push(`<path d="${d}" fill="none" stroke="${css(g.color)}" stroke-width="${n2(g.width)}"/>`);
  }
  const leftLabel = (t: string, y: number, st: TextStyle) => label(t, fl - 0.53 * dx - sideAnchor(st.size), y + 0.3 * -dy, st, 'end');
  if (!A.deleted) {
    A.ticks.forEach((t, i) => out.push(hz ? label(A.labels[i], vp(t), fb + valCenter(A.style.size) + 0.4 * -dy, A.style) : leftLabel(A.labels[i], vp(t), A.style)));
  }
  if (!catDeleted) {
    cats.forEach((c, i) => out.push(hz ? leftLabel(c, fb - (i + 0.5) * band, catStyle) : label(c, fl + (i + 0.5) * band, fb + catCenter(catStyle.size) + 0.4 * -dy, catStyle)));
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
