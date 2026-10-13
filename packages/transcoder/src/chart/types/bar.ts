/** 柱形图、条形图（簇状、堆积、百分比堆积）：画在共享的分类轴上 */
import { css } from '../../model/color';
import { n2 } from '../../common/svg';
import { label } from '../draw';
import { labelText } from '../format';
import type { ChartType } from '../chart-type';

export const barType: ChartType = {
  kind: 'bar',
  tags: ['barChart', 'bar3DChart'],
  layout: 'category',
  hasAxes: true,
  legendByCategory: false,
  defaultGrouping: 'clustered',
  horizontal: (p) => p.horizontal,
  legendReversed: (p) => p.horizontal,
  seriesRules: () => ({ xy: false, defaultLine: false, marker: () => false }),
  legendKey: (_p, s) => ({ color: s.fill, line: false }),
  renderOnAxes(p, f, A, out, labelsOut) {
    const { band, nCat, left, bottom, pw, ph, horizontal } = f;
    const nSer = p.series.length;
    const vpos = A.pos;
    const valFmt = A.fmt;
    const zeroF = vpos(Math.max(A.lo, Math.min(A.hi, 0)));
    const stacked = p.grouping === 'stacked' || p.grouping === 'percentStacked';
    const ov = stacked ? 1 : p.overlap / 100;
    const slots = stacked ? 1 : nSer - (nSer - 1) * ov;
    const barW = band / (slots + p.gapWidth / 100);
    const pos = new Array(nCat).fill(0), neg = new Array(nCat).fill(0);
    const totals = new Array(nCat).fill(0).map((_, i) => p.series.reduce((a, s) => a + Math.abs(s.vals[i] ?? 0), 0) || 1);
    p.series.forEach((s, si) => {
      for (let i = 0; i < nCat; i++) {
        let v = s.vals[i];
        if (v === null || v === undefined) continue;
        if (p.grouping === 'percentStacked') v = v / totals[i];
        let a: number, b: number;
        if (stacked) {
          const base = v >= 0 ? pos[i] : neg[i];
          a = base; b = base + v;
          if (v >= 0) pos[i] = b; else neg[i] = b;
        } else { a = 0; b = v; }
        const fa = stacked ? vpos(a) : zeroF, fb = vpos(b);
        const offset = i * band + (band - barW * slots) / 2 + (stacked ? 0 : si * barW * (1 - ov));
        const color = s.pointFills.get(i) ?? s.fill;
        if (!color) continue;
        const lb = s.labels;
        const raw = s.vals[i] ?? 0;
        const text = lb ? labelText(lb, raw, totals[i], s.cats[i] ?? '', s.name, valFmt) : '';
        const inside = stacked || lb?.pos === 'ctr' || lb?.pos === 'inEnd' || lb?.pos === 'inBase';
        if (!horizontal) {
          const y1 = bottom - Math.max(fa, fb) * ph, y2 = bottom - Math.min(fa, fb) * ph;
          out.push(`<rect x="${n2(left + offset)}" y="${n2(y1)}" width="${n2(barW)}" height="${n2(y2 - y1)}" fill="${css(color)}"/>`);
          if (text) labelsOut.push(label(text, left + offset + barW / 2, inside ? (y1 + y2) / 2 : y1 - 4 - lb!.style.size * 0.55, lb!.style));
        } else {
          const x1 = left + Math.min(fa, fb) * pw, x2 = left + Math.max(fa, fb) * pw;
          out.push(`<rect x="${n2(x1)}" y="${n2(bottom - offset - barW)}" width="${n2(x2 - x1)}" height="${n2(barW)}" fill="${css(color)}"/>`);
          if (text) labelsOut.push(label(text, inside ? (x1 + x2) / 2 : x2 + 4, bottom - offset - barW / 2, lb!.style, inside ? 'middle' : 'start'));
        }
      }
    });
  },
};
