/** 散点图：横轴、纵轴都是数值轴（坐标框架见 xy.ts） */
import { css } from '../../model/color';
import { n2 } from '../../common/svg';
import { cpart, linePath, markerSvg } from '../draw';
import { dashCap } from '../trendline';
import { renderXY } from '../xy';
import type { ChartType } from '../chart-type';

export const scatterType: ChartType = {
  kind: 'scatter',
  tags: ['scatterChart'],
  layout: 'standalone',
  hasAxes: true,
  legendByCategory: false,
  seriesRules: () => ({ xy: true, defaultLine: true, marker: (symbol) => symbol !== 'none' }),
  legendKey: (_p, s) => (s.line?.color ? { color: s.line.color, line: true } : { color: s.markerFill, line: false }),
  render: (p, a, ctx) => renderXY(p, ctx, a, {
    series(s, pts, _f, out) {
      if (s.line?.color) out.push(cpart(`${s.index}s`, `<path d="${linePath(pts.map((q) => [q.x, q.y] as const), s.smooth)}" fill="none" stroke="${css(s.line.color)}" stroke-width="${n2(s.line.width)}" stroke-linejoin="round"${s.line.dash ? dashCap(s.line) : ' stroke-linecap="round"'}/>`));
      if (s.marker) for (const q of pts) out.push(cpart(`${s.index}x${q.i}`, markerSvg(s, q.x, q.y)));
    },
  }),
};
