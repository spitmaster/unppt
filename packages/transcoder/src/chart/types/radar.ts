/** 雷达图：分类沿圆周均匀分布 */
import { attr, child } from '../../io/xml';
import { css } from '../../model/color';
import { n2 } from '../../common/svg';
import { label, markerSvg, textStyle } from '../draw';
import { sideGap, type TextWidth } from '../layout';
import { axesOf } from '../axis';
import type { AxisInfo, Plot, TextStyle } from '../model';
import type { ChartType } from '../chart-type';

/** 雷达图：分类沿圆周均匀分布，从正上方顺时针；网格是多边形 */
function renderRadar(p: Plot, A: AxisInfo, catStyle: TextStyle, catDeleted: boolean, tw: TextWidth, left: number, top: number, right: number, bottom: number): string {
  const cats = p.series[0]?.cats ?? [];
  const n = Math.max(1, ...p.series.map((s) => s.vals.length));
  const maxW = catDeleted ? 0 : Math.max(0, ...cats.map((c) => tw(c, catStyle.size)));
  // 标签和图形之间的间隙：和坐标轴标签同一规律（0.8 倍字号）
  const gap = sideGap(catStyle.size);
  // 按多边形顶点实际伸出的范围留标签空间（五边形左右顶点只到半径的 0.951 倍）
  let sMax = 0, cMax = 0;
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n;
    sMax = Math.max(sMax, Math.abs(Math.sin(a)));
    cMax = Math.max(cMax, Math.abs(Math.cos(a)));
  }
  const r = Math.max(1, Math.min(((right - left) / 2 - maxW - gap) / (sMax || 1), ((bottom - top) / 2 - catStyle.size * 1.2 - gap) / (cMax || 1)));
  const cx = (left + right) / 2, cy = (top + bottom) / 2;
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
      if (s.fill) out.push(`<polygon points="${poly(pts)}" fill="${css(s.fill)}"/>`);
      continue;
    }
    if (s.line?.color) out.push(`<polygon points="${poly(pts)}" fill="none" stroke="${css(s.line.color)}" stroke-width="${n2(s.line.width)}" stroke-linejoin="round"/>`);
    if (s.marker) for (const q of pts) out.push(markerSvg(s, q[0], q[1]));
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
    return renderRadar(p, ctx.makeAxis(valAxes[0], vmin, vmax, false), rStyle, attr(child(catAxes[0], 'c:delete'), 'val') === '1', ctx.width, a.left, a.top, a.right, a.bottom);
  },
};
