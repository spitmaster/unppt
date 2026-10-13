/** 柱形图、条形图（簇状、堆积、百分比堆积）：画在共享的分类轴上 */
import { n2 } from '../../common/svg';
import { cpart, label, lineOf, paintOf, strokeOf } from '../draw';
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
        // 柱子的边对齐整像素（pixel-grid.ts）：没有边框时填充的边对齐像素边界，有边框时矩形放在边框线（按线的规则对齐）的中心
        const [cs, csl] = f.catSpan(offset, barW);
        const sw = lineOf(s, i)?.width ?? 0;
        const edge = (axis: 'x' | 'y', v: number) => (sw ? f.snap.line(axis, v, sw) : f.snap[axis](v));
        const cAxis = horizontal ? 'y' : 'x', vAxis = horizontal ? 'x' : 'y';
        const c1 = edge(cAxis, cs), cl = edge(cAxis, cs + csl) - c1;
        const va = edge(vAxis, f.valPx(fa)), vb = edge(vAxis, f.valPx(fb));
        const v1 = Math.min(va, vb), v2 = Math.max(va, vb);
        // 内侧末端 / 内侧底部（非堆积）：离柱子那一头 1.1 倍字号（柱形图，到标签中心）或 0.5 倍字号（条形图，到文字边，实测）
        const at = !stacked && (lb?.pos === 'inEnd' || lb?.pos === 'inBase') ? lb.pos : undefined;
        const sz = lb?.style.size ?? 0;
        if (!horizontal) {
          out.push(cpart(`${s.index}x${i}`, `<rect x="${n2(c1)}" y="${n2(v1)}" width="${n2(cl)}" height="${n2(v2 - v1)}" fill="${paintOf(s, i, color)}"${strokeOf(s, i)}/>`));
          // 柱子往上长（正数）时末端是上边
          const endTop = (vb < va) === (at === 'inEnd');
          const y = at ? (endTop ? v1 + 1.1 * sz : v2 - 1.1 * sz) : inside ? (v1 + v2) / 2 : v1 - 4 - sz * 0.55;
          if (text) labelsOut.push(cpart(`${s.index}x${i}l`, label(text, c1 + cl / 2, y, lb!.style)));
        } else {
          out.push(cpart(`${s.index}x${i}`, `<rect x="${n2(v1)}" y="${n2(c1)}" width="${n2(v2 - v1)}" height="${n2(cl)}" fill="${paintOf(s, i, color)}"${strokeOf(s, i)}/>`));
          const endRight = (vb > va) === (at === 'inEnd');
          const x = at ? (endRight ? v2 - 0.5 * sz : v1 + 0.5 * sz) : inside ? (v1 + v2) / 2 : v2 + 4;
          const anchor = at ? (endRight ? 'end' : 'start') : inside ? 'middle' : 'start';
          if (text) labelsOut.push(cpart(`${s.index}x${i}l`, label(text, x, c1 + cl / 2, lb!.style, anchor)));
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
