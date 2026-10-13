/** 数值轴：自动刻度（按 Excel 的习惯取整）和刻度信息 */
import { child, attr, numAttr, type XEl } from '../io/xml';
import type { ColorContext } from '../model/color';
import { parseLine } from '../style/line';
import { textStyle } from './draw';
import { formatNumber } from './format';
import type { AxisInfo, AxisMaker, TextStyle } from './model';

/** 坐标轴刻度：按 Excel 的习惯取整（最大值留约 5% 余量，单位取 1/2/5 × 10^n） */
export function niceScale(min: number, max: number, fixedMin?: number, fixedMax?: number, fixedUnit?: number, margin = 0.05) {
  let lo = fixedMin ?? (min >= 0 ? 0 : min);
  let hi = fixedMax ?? max;
  if (hi === lo) hi = lo + 1;
  const span = (fixedMax ?? (hi + (hi - lo) * margin)) - lo;
  let unit = fixedUnit ?? 0;
  if (!unit) {
    const mag = Math.pow(10, Math.floor(Math.log10(span)));
    for (const m of [0.1, 0.2, 0.5, 1, 2, 5, 10]) {
      unit = m * mag;
      if (span / unit <= 10) break;
    }
  }
  if (fixedMax === undefined) hi = Math.ceil(Math.round(((hi + (hi - lo) * margin) / unit) * 1e9) / 1e9) * unit;
  if (fixedMin === undefined && lo < 0) lo = Math.floor(lo / unit) * unit;
  return { lo, hi, unit };
}

/** 绘图区里的数值轴和分类轴元素 */
export function axesOf(plotArea: XEl | undefined): { valAxes: XEl[]; catAxes: XEl[] } {
  return {
    valAxes: (plotArea?.children ?? []).filter((c) => c.name === 'c:valAx'),
    catAxes: (plotArea?.children ?? []).filter((c) => c.name === 'c:catAx' || c.name === 'c:dateAx'),
  };
}

/** 坐标轴编号（c:axId） */
export const axId = (a: XEl | undefined) => attr(child(a, 'c:axId'), 'val') ?? '';

export function axisMaker(colors: ColorContext, baseText: TextStyle, part: string): AxisMaker {
  return (ax, vmin, vmax, pct, margin): AxisInfo => {
    const scaling = child(ax, 'c:scaling');
    const sc = niceScale(vmin, vmax, numAttr(child(scaling, 'c:min'), 'val'), numAttr(child(scaling, 'c:max'), 'val'), numAttr(child(ax, 'c:majorUnit'), 'val'), margin);
    const fmt = attr(child(ax, 'c:numFmt'), 'formatCode') ?? (pct ? '0%' : 'General');
    const ticks: number[] = [];
    for (let v = sc.lo; v <= sc.hi + sc.unit * 1e-6; v += sc.unit) ticks.push(Math.round(v / sc.unit) * sc.unit);
    const g = child(ax, 'c:majorGridlines');
    return {
      lo: sc.lo, hi: sc.hi, ticks, labels: ticks.map((t) => formatNumber(t, fmt)), fmt,
      deleted: attr(child(ax, 'c:delete'), 'val') === '1',
      style: textStyle(child(ax, 'c:txPr'), colors, baseText),
      grid: g ? parseLine([child(child(g, 'c:spPr'), 'a:ln')], [colors], part) ?? { color: { r: 217, g: 217, b: 217, a: 1 }, width: 1, cap: 'butt', join: 'round' } : undefined,
      axisLine: parseLine([child(child(ax, 'c:spPr'), 'a:ln')], [colors], part),
      pos: (v: number) => (v - sc.lo) / (sc.hi - sc.lo),
    };
  };
}
