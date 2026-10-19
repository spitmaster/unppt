/** 柱形图、条形图（簇状、堆积、百分比堆积）：画在共享的分类轴上 */
import { n2 } from '../../common/svg';
import { cpart, label, lineOf, paintOf, strokeOf } from '../draw';
import { labelParts, labelText } from '../format';
import { pointLabel, pointLabelText, shiftLabel } from '../point-labels';
import { errRanges, errSvg } from '../error-bars';
import type { ChartType } from '../chart-type';
import type { Plot } from '../model';

/** 实测：竖排数据标签离柱子顶端的距离 = ROT_LABEL_GAP + ROT_LABEL_GAP_S × 字号（像素） */
const ROT_LABEL_GAP = 2.5, ROT_LABEL_GAP_S = 0.4;

const stackedGrouping = (p: Plot) => p.grouping === 'stacked' || p.grouping === 'percentStacked';

export const barType: ChartType = {
  kind: 'bar',
  tags: ['barChart', 'bar3DChart'],
  layout: 'category',
  hasAxes: true,
  legendByCategory: false,
  defaultGrouping: 'clustered',
  horizontal: (p) => p.horizontal,
  // 簇状条形图第一个系列画在每组的最下面，图例倒过来和它对应（分类轴逆序时整体翻过来，图例不倒）；堆积条形图不倒。
  // 堆积柱形图第一个系列在最下面：竖排图例倒序，横排图例不倒（实测 charts-pct-stacked）
  legendReversed: (p, vertical) => (p.horizontal ? !stackedGrouping(p) && !p.catReversed : vertical && stackedGrouping(p)),
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
        // 超出坐标轴范围的部分不画；整根都在范围外的（样本：最小值 70%，没数据的月份填了 0）柱子和数值标签都不画
        const ra = stacked ? vpos(a) : zeroF, rb = vpos(b);
        const fa = Math.max(0, Math.min(1, ra)), fb = Math.max(0, Math.min(1, rb));
        if (fa === fb && ra !== rb) continue;
        const offset = i * band + (band - barW * slots) / 2 + (stacked ? 0 : si * barW * (1 - ov));
        const color = s.pointFills.get(i) ?? s.fill;
        if (!color) continue;
        const pl = pointLabel(s, i), lb = pl.labels;
        const raw = s.vals[i] ?? 0;
        const text = lb ? pointLabelText(s, pl, i, () => labelText(lb, raw, totals[i], s.cats[i] ?? '', s.name, valFmt), () => labelParts(lb, raw, totals[i], s.cats[i] ?? '', valFmt)) : '';
        const lbl = (svg: string) => shiftLabel(svg, pl, f.chart);
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
          if (text && lb!.style.rot && !at && !inside) {
            // 竖排的数据标签（txPr 转 ±90°）：文字从柱子顶端往上排，离顶端 2.5 + 0.4 × 字号（ChartStyle 202 的导出图量）
            const r = lb!.style.rot;
            labelsOut.push(cpart(`${s.index}x${i}l`, lbl(`<g transform="translate(${n2(c1 + cl / 2)} ${n2(v1 - ROT_LABEL_GAP - ROT_LABEL_GAP_S * sz)}) rotate(${n2(r)})">${label(text, 0, 0, lb!.style, r < 0 ? 'start' : 'end')}</g>`)));
          } else if (text) labelsOut.push(cpart(`${s.index}x${i}l`, lbl(label(text, c1 + cl / 2, y, lb!.style))));
        } else {
          out.push(cpart(`${s.index}x${i}`, `<rect x="${n2(v1)}" y="${n2(c1)}" width="${n2(v2 - v1)}" height="${n2(cl)}" fill="${paintOf(s, i, color)}"${strokeOf(s, i)}/>`));
          const endRight = (vb > va) === (at === 'inEnd');
          const x = at ? (endRight ? v2 - 0.5 * sz : v1 + 0.5 * sz) : inside ? (v1 + v2) / 2 : v2 + 4;
          const anchor = at ? (endRight ? 'end' : 'start') : inside ? 'middle' : 'start';
          if (text) labelsOut.push(cpart(`${s.index}x${i}l`, lbl(label(text, x, c1 + cl / 2, lb!.style, anchor))));
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
