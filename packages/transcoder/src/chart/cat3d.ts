/**
 * 三维柱形图（c:bar3DChart、竖向、直角坐标轴的斜投影）：背景墙和左侧墙上的网格线、立方体的柱子。
 * PowerPoint 实测（charts-3d 导出图，rotX 15°、rotY 20°、深度 100%、间隙深度 150%）：
 *   - 正面不缩短，深度方向在屏幕上是 (sin rotY, −sin rotX) × 深度；柱子深度 = 柱宽 × 深度%，
 *     墙的深度 = 柱子深度 × (1 + 间隙深度% / 2)，柱子贴着正面；
 *   - 数值轴不加 5% 余量；背景墙右上角比平面布局的绘图区右上角往里 (0.28·dx, 0.42·|dy|)，正面底边比平面布局高 0.77·|dy|；
 *   - 数值标签在左侧墙前沿往左再让出 0.53·dx、往下 0.3·|dy|，分类标签往下 0.4·|dy|；
 *   - 顶面是正面颜色 × 0.76，右侧面 × 0.64。
 * 其它三维图（条形、折线、面积、透视投影）还按平面画。
 */
import { css, type ColorContext, type Rgba } from '../model/color';
import { n2 } from '../common/svg';
import { attr, child, type XEl } from '../io/xml';
import { cpart, label, textStyle } from './draw';
import { catBand, catCenter, PAD, SIDE_LABEL_PAD, sideAnchor, sideGap, topForLabel, type TextWidth } from './layout';
import type { AxisMaker, Plot, Rect, TextStyle, View3D } from './model';

export interface Cat3DEnv { colors: ColorContext; part: string; baseText: TextStyle; makeAxis: AxisMaker; tw: TextWidth; w: number; view: View3D }

const TOP_SHADE = 0.76, SIDE_SHADE = 0.64;
const shadeOf = (c: Rgba, k: number): Rgba => ({ r: Math.round(c.r * k), g: Math.round(c.g * k), b: Math.round(c.b * k), a: c.a });

/** 能按三维柱形图画的：只有一个竖向的 bar3DChart，直角坐标轴 */
export const isColumn3D = (plots: Plot[], view?: View3D) => !!view && plots.length === 1 && plots[0].is3D && plots[0].kind === 'bar' && !plots[0].horizontal && view.rAngAx;

export function renderColumn3D(p: Plot, valAx: XEl | undefined, catAx: XEl | undefined, area: Rect, env: Cat3DEnv, out: string[]): void {
  const { colors, baseText, makeAxis, tw, view } = env;
  const cats = p.series[0]?.cats ?? [];
  const nCat = Math.max(1, ...p.series.map((s) => s.vals.length));
  const nSer = Math.max(1, p.series.length);
  const stacked = p.grouping === 'stacked' || p.grouping === 'percentStacked';
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
  const valDeleted = attr(child(valAx, 'c:delete'), 'val') === '1';
  const catDeleted = attr(child(catAx, 'c:delete'), 'val') === '1';
  const place = (len?: number) => {
    const A = makeAxis(valAx, vmin, vmax, { pct: p.grouping === 'percentStacked', margin: 0, length: len });
    let { left, top, right, bottom } = area;
    if (!A.deleted) {
      left = (left === PAD ? SIDE_LABEL_PAD : left) + Math.max(0, ...A.labels.map((t) => tw(t, A.style.size))) + sideGap(A.style.size);
      top = Math.max(top, topForLabel(A.style.size));
    }
    if (!catDeleted) bottom -= catBand(catStyle.size);
    return { A, left, top, right, bottom };
  };
  const first = place();
  const { A, left, top, right, bottom } = place(first.bottom - first.top);
  // 深度：柱宽由正面宽度和间隙宽度决定
  const band0 = (right - left) / nCat;
  const barW0 = band0 / ((stacked ? 1 : nSer) + p.gapWidth / 100);
  const rx = Math.sin((view.rotY * Math.PI) / 180), ry = Math.sin((view.rotX * Math.PI) / 180);
  const barDepth = barW0 * view.depthPercent / 100;
  const wallDepth = barDepth * (1 + p.gapDepth / 200);
  const dx = wallDepth * rx, dy = -wallDepth * ry;
  const bdx = barDepth * rx, bdy = -barDepth * ry;
  // 正面：左下角固定；背景墙右上角往里收一点（实测）
  const backRight = right - 0.28 * dx, backTop = top + 0.42 * -dy;
  const fl = left + 0.53 * dx, fb = bottom - 0.77 * -dy;
  const fr = backRight - dx, ft = backTop - dy;
  const fw = Math.max(1, fr - fl), fh = Math.max(1, fb - ft);
  const band = fw / nCat;
  const barW = band / ((stacked ? 1 : nSer) + p.gapWidth / 100);
  const vy = (v: number) => fb - A.pos(v) * fh;
  // 网格线：左侧墙上的斜线 + 背景墙上的横线
  const g = A.grid;
  if (g?.color) {
    const d = A.ticks.map((t) => { const y = vy(t); return `M${n2(fl)} ${n2(y)}L${n2(fl + dx)} ${n2(y + dy)}H${n2(fr + dx)}`; }).join('');
    out.push(`<path d="${d}" fill="none" stroke="${css(g.color)}" stroke-width="${n2(g.width)}"/>`);
  }
  if (!valDeleted) A.ticks.forEach((t, i) => out.push(label(A.labels[i], fl - 0.53 * dx - sideAnchor(A.style.size), vy(t) + 0.3 * -dy, A.style, 'end')));
  if (!catDeleted) cats.forEach((c, i) => out.push(label(c, fl + (i + 0.5) * band, fb + catCenter(catStyle.size) + 0.4 * -dy, catStyle)));
  // 柱子：从左往右画（右侧面会被右边的柱子挡住）
  const base = new Array(nCat).fill(0), neg = new Array(nCat).fill(0);
  const totals = new Array(nCat).fill(0).map((_, i) => p.series.reduce((a, s) => a + Math.abs(s.vals[i] ?? 0), 0) || 1);
  const boxes: { key: string; x: number; y1: number; y2: number; color: Rgba }[] = [];
  p.series.forEach((s, si) => {
    for (let i = 0; i < nCat; i++) {
      let v = s.vals[i];
      if (v === null || v === undefined) continue;
      if (p.grouping === 'percentStacked') v = v / totals[i];
      let a = 0, b = v;
      if (stacked) { const b0 = v >= 0 ? base[i] : neg[i]; a = b0; b = b0 + v; if (v >= 0) base[i] = b; else neg[i] = b; }
      const color = s.pointFills.get(i) ?? s.fill;
      if (!color) continue;
      const x = fl + i * band + (band - barW * (stacked ? 1 : nSer)) / 2 + (stacked ? 0 : si * barW);
      boxes.push({ key: `${s.index}x${i}`, x, y1: vy(Math.max(a, b)), y2: vy(Math.min(a, b)), color });
    }
  });
  boxes.sort((m, n) => m.x - n.x || n.y2 - m.y2);
  for (const bx of boxes) {
    const { x, y1, y2, color } = bx;
    const front = `<rect x="${n2(x)}" y="${n2(y1)}" width="${n2(barW)}" height="${n2(Math.max(0, y2 - y1))}" fill="${css(color)}"/>`;
    const topFace = `<path d="M${n2(x)} ${n2(y1)}l${n2(bdx)} ${n2(bdy)}h${n2(barW)}l${n2(-bdx)} ${n2(-bdy)}Z" fill="${css(shadeOf(color, TOP_SHADE))}"/>`;
    const side = `<path d="M${n2(x + barW)} ${n2(y1)}l${n2(bdx)} ${n2(bdy)}V${n2(y2 + bdy)}l${n2(-bdx)} ${n2(-bdy)}Z" fill="${css(shadeOf(color, SIDE_SHADE))}"/>`;
    out.push(cpart(bx.key, side + topFace + front));
  }
}

