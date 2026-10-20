/**
 * 坐标轴线、网格线没写线条（c:spPr 里没有 a:ln，老版本 Office 做的图表常见）时 PowerPoint 照样画，颜色看图表样式
 * （实测 charts-axis-no-sppr、charts-axis-style-defaults）：
 *   - 写了 Office 2010 起的图表样式（c14:style）：灰色 #898989；
 *   - 只有老的 c:style（1~48 都一样）或都没写：黑色；
 * 都是 1 像素（0.75 磅），分类轴、数值轴的刻度线跟着轴线画。写了 a:ln 的按写的（noFill 就不画）。
 */
import { child, findAll, type XEl } from '../io/xml';
import type { ColorContext } from '../model/color';
import { parseLine, type Line } from '../style/line';

const line = (v: number): Line => ({ color: { r: v, g: v, b: v, a: 1 }, width: 1, cap: 'butt', join: 'round' });

/** 这个图表的默认线 */
export function chartDefaultLine(chartSpace: XEl | undefined): Line {
  return findAll(chartSpace, 'c14:style').length ? line(0x89) : line(0);
}

/** el（坐标轴、网格线）的线：没写 a:ln 时用默认线 */
export function lineOrDefault(el: XEl | undefined, colors: ColorContext, part: string, def: Line | undefined): Line | undefined {
  const ln = child(child(el, 'c:spPr'), 'a:ln');
  return ln ? parseLine([ln], [colors], part) : def;
}
