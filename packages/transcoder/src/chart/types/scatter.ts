/** 散点图：横轴、纵轴都是数值轴 */
import { attr, child, type XEl } from '../../io/xml';
import { css } from '../../model/color';
import { n2 } from '../../common/svg';
import { label, markerSvg, textWidth } from '../draw';
import { axesOf } from '../axis';
import type { AxisMaker, Plot } from '../model';
import type { ChartType } from '../chart-type';

/** 散点图：横轴、纵轴都是数值轴 */
function renderScatter(p: Plot, valAxes: XEl[], makeAxis: AxisMaker, left: number, top: number, right: number, bottom: number): string {
  const xAx = valAxes.find((a) => { const pos = attr(child(a, 'c:axPos'), 'val'); return pos === 'b' || pos === 't'; }) ?? valAxes[0];
  const yAx = valAxes.find((a) => a !== xAx) ?? valAxes[1];
  let x0 = 0, x1 = 0, y0 = 0, y1 = 0;
  for (const s of p.series) {
    s.vals.forEach((v, i) => {
      const x = s.xs?.[i];
      if (v === null || x === null || x === undefined) return;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, v); y1 = Math.max(y1, v);
    });
  }
  const X = makeAxis(xAx, x0, x1, false), Y = makeAxis(yAx, y0, y1, false);
  if (!Y.deleted) left += Math.max(...Y.labels.map((t) => textWidth(t, Y.style.size))) + 6;
  if (!X.deleted) bottom -= X.style.size * 1.2 + 8;
  const pw = Math.max(1, right - left), ph = Math.max(1, bottom - top);
  const out: string[] = [];
  Y.ticks.forEach((t, i) => {
    const y = bottom - Y.pos(t) * ph;
    if (Y.grid?.color) out.push(`<line x1="${n2(left)}" y1="${n2(y)}" x2="${n2(right)}" y2="${n2(y)}" stroke="${css(Y.grid.color)}" stroke-width="${n2(Y.grid.width)}"/>`);
    if (!Y.deleted) out.push(label(Y.labels[i], left - 6, y, Y.style, 'end'));
  });
  X.ticks.forEach((t, i) => {
    const x = left + X.pos(t) * pw;
    if (X.grid?.color) out.push(`<line x1="${n2(x)}" y1="${n2(top)}" x2="${n2(x)}" y2="${n2(bottom)}" stroke="${css(X.grid.color)}" stroke-width="${n2(X.grid.width)}"/>`);
    if (!X.deleted) out.push(label(X.labels[i], x, bottom + X.style.size * 0.8, X.style));
  });
  // 坐标轴线：横轴画在纵轴 0 的位置，纵轴画在横轴 0 的位置
  const x0f = X.pos(Math.max(X.lo, Math.min(X.hi, 0))), y0f = Y.pos(Math.max(Y.lo, Math.min(Y.hi, 0)));
  if (X.axisLine?.color && !X.deleted) out.push(`<line x1="${n2(left)}" y1="${n2(bottom - y0f * ph)}" x2="${n2(right)}" y2="${n2(bottom - y0f * ph)}" stroke="${css(X.axisLine.color)}" stroke-width="${n2(X.axisLine.width)}"/>`);
  if (Y.axisLine?.color && !Y.deleted) out.push(`<line x1="${n2(left + x0f * pw)}" y1="${n2(top)}" x2="${n2(left + x0f * pw)}" y2="${n2(bottom)}" stroke="${css(Y.axisLine.color)}" stroke-width="${n2(Y.axisLine.width)}"/>`);
  for (const s of p.series) {
    const pts: [number, number][] = [];
    s.vals.forEach((v, i) => {
      const x = s.xs?.[i];
      if (v === null || x === null || x === undefined) return;
      pts.push([left + X.pos(x) * pw, bottom - Y.pos(v) * ph]);
    });
    if (!pts.length) continue;
    if (s.line?.color) out.push(`<path d="M${pts.map((q) => `${n2(q[0])} ${n2(q[1])}`).join('L')}" fill="none" stroke="${css(s.line.color)}" stroke-width="${n2(s.line.width)}" stroke-linejoin="round" stroke-linecap="round"/>`);
    if (s.marker) for (const q of pts) out.push(markerSvg(s, q[0], q[1]));
  }
  return out.join('');
}

export const scatterType: ChartType = {
  kind: 'scatter',
  tags: ['scatterChart'],
  layout: 'standalone',
  hasAxes: true,
  legendByCategory: false,
  seriesRules: () => ({ xy: true, defaultLine: true, marker: (symbol) => symbol !== 'none' }),
  legendKey: (_p, s) => (s.line?.color ? { color: s.line.color, line: true } : { color: s.markerFill, line: false }),
  render: (p, a, ctx) => renderScatter(p, axesOf(ctx.plotArea).valAxes, ctx.makeAxis, a.left, a.top, a.right, a.bottom),
};
