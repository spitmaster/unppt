/** 折线图、面积图（含堆积）：画在共享的分类轴上 */
import { css } from '../../model/color';
import { n2 } from '../../common/svg';
import { attr, child } from '../../io/xml';
import { cpart, label, linePath, markerSvg } from '../draw';
import { labelText } from '../format';
import { errRanges, errSvg } from '../error-bars';
import type { ChartType, CategoryFrame } from '../chart-type';
import type { AxisInfo, Plot } from '../model';

function renderLineArea(p: Plot, f: CategoryFrame, A: AxisInfo, out: string[], labelsOut: string[]): void {
  const { nCat, catCenter } = f;
  const vpos = A.pos;
  const valFmt = A.fmt;
  const acc = new Array(nCat).fill(0);
  const series = p.kind === 'area' && p.grouping !== 'standard' ? p.series : p.series;
  const drawn: string[] = [];
  series.forEach((s) => {
    const pts: [number, number][] = [];
    const base: [number, number][] = [];
    const ptCat: number[] = [];
    for (let i = 0; i < nCat; i++) {
      const v = s.vals[i];
      if (v === null || v === undefined) continue;
      const stacked = p.grouping === 'stacked' || p.grouping === 'percentStacked';
      const b0 = stacked ? acc[i] : 0;
      const v1 = stacked ? acc[i] + v : v;
      if (stacked) acc[i] = v1;
      const x = f.catPx(catCenter(i));
      pts.push([x, f.valPx(vpos(v1))]);
      base.push([x, f.valPx(vpos(b0))]);
      ptCat.push(i);
    }
    if (!pts.length) return;
    if (p.kind === 'area') {
      const d = `M${pts.map((q) => `${n2(q[0])} ${n2(q[1])}`).join('L')}L${base.reverse().map((q) => `${n2(q[0])} ${n2(q[1])}`).join('L')}Z`;
      if (s.fill) drawn.push(cpart(`${s.index}s`, `<path d="${d}" fill="${css(s.fill)}"/>`));
    } else {
      // 无线条的系列不画线；三维折线图是用填充色画的带子，按平面画时仍用填充色画线
      const lc = s.noLine && !p.is3D ? undefined : s.line?.color ?? s.fill;
      if (lc) drawn.push(cpart(`${s.index}s`, `<path d="${linePath(pts, s.smooth)}" fill="none" stroke="${css(lc)}" stroke-width="${n2(s.line?.width ?? 3)}" stroke-linejoin="round" stroke-linecap="round"/>`));
      if (s.marker && (lc || s.markerFill || s.markerLine)) pts.forEach((q, k) => drawn.push(cpart(`${s.index}x${ptCat[k]}`, markerSvg(s, q[0], q[1]))));
      if (p.grouping === 'standard') {
        for (const e of s.errBars) {
          errRanges(e, s.vals).forEach((r, i) => {
            if (r) drawn.push(cpart(`${s.index}x${i}e`, errSvg(e, f.catPx(catCenter(i)), f.valPx(vpos(r[0])), f.valPx(vpos(r[1])), true)));
          });
        }
      }
      const lb = s.labels;
      if (lb) {
        let k = 0;
        for (let i = 0; i < nCat; i++) {
          const v = s.vals[i];
          if (v === null || v === undefined) continue;
          const q = pts[k++];
          const text = labelText(lb, v, 0, s.cats[i] ?? '', s.name, valFmt);
          const pos = lb.pos ?? 'r';
          const key = `${s.index}x${i}l`;
          if (pos === 't') labelsOut.push(cpart(key, label(text, q[0], q[1] - 6 - lb.style.size * 0.5, lb.style)));
          else if (pos === 'b') labelsOut.push(cpart(key, label(text, q[0], q[1] + 6 + lb.style.size * 0.5, lb.style)));
          else if (pos === 'l') labelsOut.push(cpart(key, label(text, q[0] - 6, q[1], lb.style, 'end')));
          else if (pos === 'ctr') labelsOut.push(cpart(key, label(text, q[0], q[1], lb.style)));
          else labelsOut.push(cpart(key, label(text, q[0] + 6, q[1], lb.style, 'start')));
        }
      }
    }
  });
  out.push(...drawn);
}

export const lineType: ChartType = {
  kind: 'line',
  tags: ['lineChart', 'line3DChart'],
  layout: 'category',
  hasAxes: true,
  legendByCategory: false,
  seriesRules: (plotEl, tag) => {
    const plotMarker = attr(child(plotEl, 'c:marker'), 'val') !== '0';
    return { xy: false, defaultLine: true, marker: (symbol) => plotMarker && symbol !== 'none' && (symbol !== undefined || tag === 'lineChart') };
  },
  legendKey: (_p, s) => (s.line?.color ? { color: s.line.color, line: true } : { color: s.fill, line: false }),
  renderOnAxes: renderLineArea,
};

export const areaType: ChartType = {
  kind: 'area',
  tags: ['areaChart', 'area3DChart'],
  layout: 'category',
  hasAxes: true,
  legendByCategory: false,
  seriesRules: () => ({ xy: false, defaultLine: false, marker: () => false }),
  legendKey: (_p, s) => ({ color: s.fill, line: false }),
  renderOnAxes: renderLineArea,
};
