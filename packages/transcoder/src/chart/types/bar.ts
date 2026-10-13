/** 柱形图、条形图（簇状、堆积、百分比堆积）：画在共享的分类轴上 */
import { n2 } from '../../common/svg';
import { cpart, label, paintOf } from '../draw';
import { labelText } from '../format';
import { errRanges, errSvg } from '../error-bars';
import type { ChartType } from '../chart-type';

export const barType: ChartType = {
  kind: 'bar',
  tags: ['barChart', 'bar3DChart'],
  layout: 'category',
  hasAxes: true,
  legendByCategory: false,
  defaultGrouping: 'clustered',
  horizontal: (p) => p.horizontal,
  // 条形图第一个系列画在每组的最下面，横排图例倒过来和它对应；分类轴逆序时整体翻过来，图例不倒
  legendReversed: (p) => p.horizontal && !p.catReversed,
  seriesRules: () => ({ xy: false, defaultLine: false, marker: () => false }),
  legendKey: (_p, s) => ({ color: s.fill, line: false }),
  renderOnAxes(p, f, A, out, labelsOut) {
    const { band, nCat, horizontal } = f;
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
    const errOut: string[] = [];
    p.series.forEach((s, si) => {
      const errs = s.errBars.map((e) => errRanges(e, s.vals));
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
        // 柱子在分类方向上的一段、在数值方向上的两端（坐标轴逆序时由 frame 换算）
        const [c1, cl] = f.catSpan(offset, barW);
        const va = f.valPx(fa), vb = f.valPx(fb);
        const v1 = Math.min(va, vb), v2 = Math.max(va, vb);
        if (!horizontal) {
          out.push(cpart(`${s.index}x${i}`, `<rect x="${n2(c1)}" y="${n2(v1)}" width="${n2(cl)}" height="${n2(v2 - v1)}" fill="${paintOf(s, i, color)}"/>`));
          if (text) labelsOut.push(cpart(`${s.index}x${i}l`, label(text, c1 + cl / 2, inside ? (v1 + v2) / 2 : v1 - 4 - lb!.style.size * 0.55, lb!.style)));
        } else {
          out.push(cpart(`${s.index}x${i}`, `<rect x="${n2(v1)}" y="${n2(c1)}" width="${n2(v2 - v1)}" height="${n2(cl)}" fill="${paintOf(s, i, color)}"/>`));
          if (text) labelsOut.push(cpart(`${s.index}x${i}l`, label(text, inside ? (v1 + v2) / 2 : v2 + 4, c1 + cl / 2, lb!.style, inside ? 'middle' : 'start')));
        }
        // 误差线（堆积时以这一段的顶端为中心）
        s.errBars.forEach((e, k) => {
          const r = errs[k][i];
          if (!r || p.grouping === 'percentStacked') return;
          const shift = stacked ? b - raw : 0;
          errOut.push(cpart(`${s.index}x${i}e`, errSvg(e, c1 + cl / 2, f.valPx(vpos(r[0] + shift)), f.valPx(vpos(r[1] + shift)), !horizontal)));
        });
      }
    });
    out.push(...errOut);
  },
};
