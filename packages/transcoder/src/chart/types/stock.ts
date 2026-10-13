/**
 * 股价图（盘高-盘低-收盘，开盘-盘高-盘低-收盘）：画在分类轴上。每个分类一条从最低到最高的竖线（c:hiLowLines），
 * 有涨跌柱（c:upDownBars）时在开盘（第一个系列）和收盘（最后一个系列）之间画柱子（见 line-extras.ts），
 * 系列本身通常不画线、收盘用小点标记（按系列自己的设置，和折线图一样画）
 */
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
  // 高低点连线、涨跌柱和系列自己的线、标记都和折线图一样画
  renderOnAxes: lineType.renderOnAxes,
};
