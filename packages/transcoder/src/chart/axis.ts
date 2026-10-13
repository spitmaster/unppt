/** 数值轴：自动刻度（按 Excel 的习惯取整）、对数刻度、逆序、次要刻度、刻度线、显示单位 */
import { child, attr, numAttr, path, findAll, type XEl } from '../io/xml';
import type { ColorContext } from '../model/color';
import { parseLine } from '../style/line';
import { textStyle } from './draw';
import { formatNumber } from './format';
import { maxTickLabels } from './layout';
import type { AxisInfo, AxisMaker, TextStyle } from './model';

/**
 * 坐标轴刻度：按 Excel 的习惯取整（最大值留约 5% 余量，单位取 1/2/5 × 10^n，不超过 10 个间隔）；
 * maxLabels 是轴上最多能放几个刻度标签（见 layout.ts 的 maxTickLabels），放不下就换更大的单位
 */
export function niceScale(min: number, max: number, fixedMin?: number, fixedMax?: number, fixedUnit?: number, margin = 0.05, maxLabels = Infinity) {
  const lo0 = fixedMin ?? (min >= 0 ? 0 : min);
  let hi0 = fixedMax ?? max;
  if (hi0 === lo0) hi0 = lo0 + 1;
  const span = (fixedMax ?? (hi0 + (hi0 - lo0) * margin)) - lo0;
  const ends = (unit: number) => ({
    lo: fixedMin === undefined && lo0 < 0 ? Math.floor(lo0 / unit) * unit : lo0,
    hi: fixedMax === undefined ? Math.ceil(Math.round(((hi0 + (hi0 - lo0) * margin) / unit) * 1e9) / 1e9) * unit : hi0,
  });
  if (fixedUnit) return { ...ends(fixedUnit), unit: fixedUnit };
  const mag = Math.pow(10, Math.floor(Math.log10(span)));
  let pick = { lo: lo0, hi: hi0, unit: mag };
  for (const m of [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100]) {
    const unit = m * mag;
    if (span / unit > 10) continue;
    pick = { ...ends(unit), unit };
    if (Math.round((pick.hi - pick.lo) / unit) + 1 <= maxLabels) break;
  }
  return pick;
}

/** 对数刻度：两端取到底数的整数次幂（Excel 的自动范围），刻度是每一次幂 */
function logScale(minPos: number, max: number, base: number, fixedMin?: number, fixedMax?: number) {
  const lg = (v: number) => Math.log(v) / Math.log(base);
  const lo = fixedMin ?? Math.pow(base, Math.floor(lg(minPos > 0 ? minPos : 1) + 1e-9));
  let hi = fixedMax ?? Math.pow(base, Math.ceil(lg(max > 0 ? max : 1) - 1e-9));
  if (hi <= lo) hi = lo * base;
  return { lo, hi };
}

/** 显示单位（c:builtInUnit）的除数和默认标签（中文界面 / 英文界面，PowerPoint 实测） */
const UNITS: Record<string, [number, string, string]> = {
  hundreds: [1e2, '百', 'Hundreds'], thousands: [1e3, '千', 'Thousands'],
  tenThousands: [1e4, 'x 10000', 'x 10000'], hundredThousands: [1e5, 'x 100000', 'x 100000'],
  millions: [1e6, '百万', 'Millions'], tenMillions: [1e7, 'x 10000000', 'x 10000000'],
  hundredMillions: [1e8, 'x 100000000', 'x 100000000'], billions: [1e9, '十亿', 'Billions'], trillions: [1e12, '兆', 'Trillions'],
};

/** 绘图区里的数值轴和分类轴元素 */
export function axesOf(plotArea: XEl | undefined): { valAxes: XEl[]; catAxes: XEl[] } {
  return {
    valAxes: (plotArea?.children ?? []).filter((c) => c.name === 'c:valAx'),
    catAxes: (plotArea?.children ?? []).filter((c) => c.name === 'c:catAx' || c.name === 'c:dateAx'),
  };
}

/** 坐标轴编号（c:axId） */
export const axId = (a: XEl | undefined) => attr(child(a, 'c:axId'), 'val') ?? '';

/** 坐标轴的方向是否反过来（"逆序刻度值"、"逆序类别"） */
export const axisReversed = (ax: XEl | undefined) => attr(path(ax, 'c:scaling', 'c:orientation'), 'val') === 'maxMin';

/** 这根轴和另一根轴交叉的位置：autoZero（数值 0 / 第一个分类）、min、max，或具体数值 */
export function axisCrosses(ax: XEl | undefined): 'autoZero' | 'min' | 'max' | number {
  const at = numAttr(child(ax, 'c:crossesAt'), 'val');
  if (at !== undefined) return at;
  const v = attr(child(ax, 'c:crosses'), 'val');
  return v === 'min' || v === 'max' ? v : 'autoZero';
}

/** 刻度线：none / in / out / cross（没写时不画） */
export const tickMark = (ax: XEl | undefined, name: 'c:majorTickMark' | 'c:minorTickMark') => attr(child(ax, name), 'val') ?? 'none';

export function axisMaker(colors: ColorContext, baseText: TextStyle, part: string, lang = 'zh'): AxisMaker {
  return (ax, vmin, vmax, opts = {}): AxisInfo => {
    const { pct = false, margin, minPos } = opts;
    const style = textStyle(child(ax, 'c:txPr'), colors, baseText);
    const scaling = child(ax, 'c:scaling');
    const fixedMin = numAttr(child(scaling, 'c:min'), 'val'), fixedMax = numAttr(child(scaling, 'c:max'), 'val');
    const base = numAttr(child(scaling, 'c:logBase'), 'val');
    const fmt = attr(child(ax, 'c:numFmt'), 'formatCode') ?? (pct ? '0%' : 'General');
    const ticks: number[] = [];
    const minor: number[] = [];
    let lo: number, hi: number, raw: (v: number) => number;
    if (base && base > 1) {
      ({ lo, hi } = logScale(minPos ?? vmin, vmax, base, fixedMin, fixedMax));
      const lg = (v: number) => Math.log(Math.max(v, 1e-300)) / Math.log(base);
      raw = (v) => (lg(v) - lg(lo)) / (lg(hi) - lg(lo));
      for (let v = lo; v <= hi * (1 + 1e-9); v *= base) {
        ticks.push(v);
        // 次要刻度：每一段里底数的整数倍（2×、3×…）
        for (let k = 2; k < base && v * base <= hi * (1 + 1e-9); k++) minor.push(v * k);
      }
    } else {
      const maxLabels = opts.length ? maxTickLabels(opts.length, style.size, !!opts.horizontal) : Infinity;
      const sc = niceScale(vmin, vmax, fixedMin, fixedMax, numAttr(child(ax, 'c:majorUnit'), 'val'), margin, maxLabels);
      ({ lo, hi } = sc);
      raw = (v) => (v - lo) / (hi - lo);
      for (let v = lo; v <= hi + sc.unit * 1e-6; v += sc.unit) ticks.push(Math.round(v / sc.unit) * sc.unit);
      // 次要单位默认是主要单位的 1/5
      const mu = numAttr(child(ax, 'c:minorUnit'), 'val') ?? sc.unit / 5;
      if (child(ax, 'c:minorGridlines') || tickMark(ax, 'c:minorTickMark') !== 'none') {
        for (let v = lo; v <= hi + mu * 1e-6; v += mu) {
          const r = Math.round(v / mu) * mu;
          if (!ticks.some((t) => Math.abs(t - r) < mu * 1e-6)) minor.push(r);
        }
      }
    }
    const reversed = axisReversed(ax);
    // 显示单位：刻度标签除以单位，旁边写单位名称
    const du = child(ax, 'c:dispUnits');
    const unitKey = attr(child(du, 'c:builtInUnit'), 'val');
    const divisor = numAttr(child(du, 'c:custUnit'), 'val') ?? (unitKey ? UNITS[unitKey]?.[0] : undefined) ?? 1;
    const lblEl = child(du, 'c:dispUnitsLbl');
    const lblText = findAll(child(lblEl, 'c:tx'), 'a:t').map((t) => t.text).join('') || (unitKey ? UNITS[unitKey]?.[lang.startsWith('zh') ? 1 : 2] : '') || String(divisor);
    const g = child(ax, 'c:majorGridlines'), mg = child(ax, 'c:minorGridlines');
    return {
      lo, hi, ticks, labels: ticks.map((t) => formatNumber(divisor === 1 ? t : t / divisor, fmt)), fmt,
      deleted: attr(child(ax, 'c:delete'), 'val') === '1',
      style,
      grid: g ? parseLine([child(child(g, 'c:spPr'), 'a:ln')], [colors], part) ?? { color: { r: 217, g: 217, b: 217, a: 1 }, width: 1, cap: 'butt', join: 'round' } : undefined,
      minor,
      minorGrid: mg ? parseLine([child(child(mg, 'c:spPr'), 'a:ln')], [colors], part) ?? { color: { r: 242, g: 242, b: 242, a: 1 }, width: 1, cap: 'butt', join: 'round' } : undefined,
      axisLine: parseLine([child(child(ax, 'c:spPr'), 'a:ln')], [colors], part),
      majorMark: tickMark(ax, 'c:majorTickMark'), minorMark: tickMark(ax, 'c:minorTickMark'),
      lblPos: attr(child(ax, 'c:tickLblPos'), 'val') ?? 'nextTo',
      crosses: axisCrosses(ax),
      reversed,
      unitLabel: lblEl && divisor !== 1 ? { text: lblText, style: textStyle(child(lblEl, 'c:txPr'), colors, style) } : undefined,
      pos: reversed ? (v: number) => 1 - raw(v) : raw,
    };
  };
}
