/**
 * 股价图（盘高-盘低-收盘，开盘-盘高-盘低-收盘）：画在分类轴上。每个分类一条从最低到最高的竖线（c:hiLowLines），
 * 有涨跌柱（c:upDownBars）时在开盘（第一个系列）和收盘（最后一个系列）之间画柱子（涨白跌黑，可以自定义），
 * 系列本身通常不画线、收盘用小点标记（按系列自己的设置，和折线图一样画）
 */
import { css } from '../../model/color';
import { n2 } from '../../common/svg';
import { cpart } from '../draw';
import type { ChartType } from '../chart-type';
import { lineType } from './line-area';

export const stockType: ChartType = {
  kind: 'stock',
  tags: ['stockChart'],
  layout: 'category',
  hasAxes: true,
  legendByCategory: false,
  seriesRules: () => ({ xy: false, defaultLine: true, marker: (symbol) => symbol !== undefined && symbol !== 'none' }),
  // 不画线、也没有标记的系列（盘高、盘低）在图例里只有名字
  legendKey: (_p, s) => (s.line?.color ? { color: s.line.color, line: true } : s.marker ? { color: s.markerFill, line: false, dot: true } : { line: false, none: true }),
  renderOnAxes(p, f, A, out, labelsOut) {
    const st = p.stock;
    const { nCat, catCenter } = f;
    const values = (i: number) => p.series.map((s) => s.vals[i]).filter((v): v is number => v !== null && v !== undefined);
    // 最高最低连线画在最下面
    if (st?.hiLow?.color) {
      const lines: string[] = [];
      for (let i = 0; i < nCat; i++) {
        const vs = values(i);
        if (vs.length) lines.push(`M${n2(f.catPx(catCenter(i)))} ${n2(f.valPx(A.pos(Math.max(...vs))))}V${n2(f.valPx(A.pos(Math.min(...vs))))}`);
      }
      if (lines.length) out.push(`<path d="${lines.join('')}" fill="none" stroke="${css(st.hiLow.color)}" stroke-width="${n2(st.hiLow.width)}"/>`);
    }
    for (let i = 0; i < nCat; i++) {
      const x = f.catPx(catCenter(i));
      // 涨跌柱：开盘 -> 收盘
      if (st?.upDown && p.series.length >= 4) {
        const open = p.series[0].vals[i], close = p.series[p.series.length - 1].vals[i];
        if (open !== null && open !== undefined && close !== null && close !== undefined) {
          const w = f.band / (1 + st.upDown.gap / 100);
          const y1 = f.valPx(A.pos(Math.max(open, close))), y2 = f.valPx(A.pos(Math.min(open, close)));
          const up = close >= open;
          const fill = up ? st.upDown.up : st.upDown.down;
          out.push(cpart(`${p.series[0].index}x${i}`, `<rect x="${n2(x - w / 2)}" y="${n2(y1)}" width="${n2(w)}" height="${n2(Math.max(0.5, y2 - y1))}" fill="${fill ? css(fill) : up ? '#fff' : '#000'}" stroke="${css(st.upDown.line ?? { r: 64, g: 64, b: 64, a: 1 })}" stroke-width="0.75"/>`));
        }
      }
    }
    // 系列自己的线和标记（一般只有收盘的点）
    lineType.renderOnAxes!(p, f, A, out, labelsOut);
  },
};
