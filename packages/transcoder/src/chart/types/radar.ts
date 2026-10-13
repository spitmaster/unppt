/** 雷达图：分类沿圆周均匀分布 */
import { attr, child } from '../../io/xml';
import { css } from '../../model/color';
import { n2 } from '../../common/svg';
import { cpart, hasCjk, label, markerSvg, textStyle } from '../draw';
import { RADAR_DY, radarLegendBand, radarMarginX, radarMarginY, sideGap, type TextWidth } from '../layout';
import { axesOf } from '../axis';
import type { AxisInfo, ChartContext, Plot, Rect, TextStyle } from '../model';
import type { ChartType } from '../chart-type';

interface RadarGeo { cx: number; cy: number; r: number }

/**
 * 外接圆的圆心和半径。没有标题、没有手动布局、图例在上面或下面（或没有）时按 PowerPoint 的规则（layout.ts）；
 * 其它情况按多边形顶点实际伸出的范围在给定区域里留出标签空间
 */
function geometry(p: Plot, catStyle: TextStyle, catDeleted: boolean, tw: TextWidth, a: Rect, ctx: ChartContext): RadarGeo {
  const cats = p.series[0]?.cats ?? [];
  const s = catStyle.size;
  const maxW = catDeleted ? 0 : Math.max(0, ...cats.map((c) => tw(c, s)));
  if (!ctx.hasTitle && !ctx.manual && (!ctx.legendPos || ctx.legendPos === 't' || ctx.legendPos === 'b')) {
    const { w, h } = ctx.box;
    const top = ctx.legendPos === 't' ? radarLegendBand(s) : 0, bottom = h - (ctx.legendPos === 'b' ? radarLegendBand(s) : 0);
    const d = Math.min(w - 2 * radarMarginX(maxW, s), bottom - top - 2 * radarMarginY(s, cats.some(hasCjk)));
    return { cx: w / 2, cy: (top + bottom) / 2 + RADAR_DY, r: Math.max(1, d / 2) };
  }
  const n = Math.max(1, ...p.series.map((x) => x.vals.length));
  // 标签和图形之间的间隙：和坐标轴标签同一规律（0.8 倍字号）；按多边形顶点实际伸出的范围留标签空间（五边形左右顶点只到半径的 0.951 倍）
  const gap = sideGap(s);
  let sMax = 0, cMax = 0;
  for (let i = 0; i < n; i++) {
    const ang = (Math.PI * 2 * i) / n;
    sMax = Math.max(sMax, Math.abs(Math.sin(ang)));
    cMax = Math.max(cMax, Math.abs(Math.cos(ang)));
  }
  const r = Math.max(1, Math.min(((a.right - a.left) / 2 - maxW - gap) / (sMax || 1), ((a.bottom - a.top) / 2 - s * 1.2 - gap) / (cMax || 1)));
  return { cx: (a.left + a.right) / 2, cy: (a.top + a.bottom) / 2, r };
}

/** 雷达图：分类沿圆周均匀分布，从正上方顺时针；网格是多边形 */
function renderRadar(p: Plot, A: AxisInfo, catStyle: TextStyle, catDeleted: boolean, tw: TextWidth, geo: RadarGeo): string {
  const cats = p.series[0]?.cats ?? [];
  const n = Math.max(1, ...p.series.map((s) => s.vals.length));
  const gap = sideGap(catStyle.size);
  const { cx, cy, r } = geo;
  const at = (i: number, f: number): [number, number] => {
    const a = (Math.PI * 2 * i) / n;
    return [cx + r * f * Math.sin(a), cy - r * f * Math.cos(a)];
  };
  const poly = (ps: [number, number][]) => ps.map((q) => `${n2(q[0])},${n2(q[1])}`).join(' ');
  const out: string[] = [];
  for (const t of A.ticks) {
    const f = A.pos(t);
    if (f <= 0 || !A.grid?.color) continue;
    out.push(`<polygon points="${poly(Array.from({ length: n }, (_, i) => at(i, f)))}" fill="none" stroke="${css(A.grid.color)}" stroke-width="${n2(A.grid.width)}"/>`);
  }
  if (!catDeleted) {
    cats.forEach((c, i) => {
      const a = (Math.PI * 2 * i) / n;
      const sin = Math.sin(a), cos = Math.cos(a);
      let [x, y] = at(i, 1);
      x += sin * gap; y -= cos * gap;
      // 标签框贴着径向方向往外放：框的中心再沿方向偏出半个框（横向按 sin、纵向按 cos）
      const bw = tw(c, catStyle.size), bh = catStyle.size * 1.2;
      out.push(label(c, x + sin * bw / 2, y - cos * bh / 2, catStyle, 'middle'));
    });
  }
  for (const s of p.series) {
    const pts = s.vals.map((v, i) => at(i, A.pos(Math.max(A.lo, Math.min(A.hi, v ?? A.lo)))));
    if (!pts.length) continue;
    if (p.radarStyle === 'filled') {
      if (s.fill) out.push(cpart(`${s.index}s`, `<polygon points="${poly(pts)}" fill="${css(s.fill)}"/>`));
      continue;
    }
    if (s.line?.color) out.push(cpart(`${s.index}s`, `<polygon points="${poly(pts)}" fill="none" stroke="${css(s.line.color)}" stroke-width="${n2(s.line.width)}" stroke-linejoin="round"/>`));
    if (s.marker) pts.forEach((q, i) => out.push(cpart(`${s.index}x${i}`, markerSvg(s, q[0], q[1]))));
  }
  // 数值刻度标签盖在系列上面
  if (!A.deleted) A.ticks.forEach((t, i) => out.push(label(A.labels[i], cx - 4, cy - r * A.pos(t), A.style, 'end')));
  return out.join('');
}

export const radarType: ChartType = {
  kind: 'radar',
  tags: ['radarChart'],
  layout: 'standalone',
  hasAxes: true,
  legendByCategory: false,
  seriesRules: (plotEl) => {
    const filled = (attr(child(plotEl, 'c:radarStyle'), 'val') ?? 'marker') === 'filled';
    return { xy: false, defaultLine: !filled, marker: (symbol) => !filled && symbol !== undefined && symbol !== 'none' };
  },
  legendKey: (p, s) => {
    if (p.radarStyle === 'filled') return { color: s.fill, line: false };
    return s.line?.color ? { color: s.line.color, line: true } : { color: s.markerFill, line: false };
  },
  render: (p, a, ctx) => {
    const { valAxes, catAxes } = axesOf(ctx.plotArea);
    let vmin = 0, vmax = 0;
    for (const s of p.series) for (const v of s.vals) if (v !== null) { vmax = Math.max(vmax, v); vmin = Math.min(vmin, v); }
    const rStyle = textStyle(child(catAxes[0], 'c:txPr'), ctx.colors, ctx.baseText);
    const catDeleted = attr(child(catAxes[0], 'c:delete'), 'val') === '1';
    return renderRadar(p, ctx.makeAxis(valAxes[0], vmin, vmax), rStyle, catDeleted, ctx.width, geometry(p, rStyle, catDeleted, ctx.width, a, ctx));
  },
};
