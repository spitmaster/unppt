/** 数值轴：自动刻度（按 Excel 的习惯取整）、对数刻度、逆序、次要刻度、刻度线、显示单位 */
import { child, attr, numAttr, path, findAll, type XEl } from '../io/xml';
import type { ColorContext } from '../model/color';
import { parseLine, type Line } from '../style/line';
import { lineOrDefault } from './default-lines';
import { textStyle } from './draw';
import { formatNumber } from './format';
import { maxTickLabels } from './layout';
import type { AxisInfo, AxisMaker, TextStyle } from './model';

/**
 * 坐标轴刻度：按 Excel 的习惯取整（最大值留约 5% 余量，单位取 1/2/5 × 10^n，不超过 10 个间隔）；
 * maxLabels 是轴上最多能放几个刻度标签（见 layout.ts 的 maxTickLabels），放不下就换更大的单位
 */
export function niceScale(min: number, max: number, fixedMin?: number, fixedMax?: number, fixedUnit?: number, margin = 0.05, maxLabels = Infinity) {
  // 数据都是正数、又挤在一起（最大最小差不超过最大值的 1/6）时不从 0 起：最小值 = 最小数据 − 差 / 2，取整到单位；
  // 上端只留 差 × 5% 的余量（COM 读自动刻度：80~90 → 74~92、100~118 → 90~120、100~121 → 0~140、1000~1050 → 970~1060，Excel 同样的规则）
  // 固定了最大值时差按固定的最大值算（80~90 固定最大 95 → 70~95、固定最大 100 → 0~100，0.0348~0.0352 固定最大 0.06 → 0~0.06）
  const top = fixedMax ?? max;
  const near = fixedMin === undefined && min >= 0 && top > min && (top - min) <= top / 6 + 1e-12;
  const lo0 = fixedMin ?? (near ? min - (top - min) / 2 : min >= 0 ? 0 : min);
  let hi0 = fixedMax ?? max;
  if (hi0 === lo0) hi0 = lo0 + 1;
  const pad = (near ? max - min : hi0 - lo0) * margin;
  // 有负数时最小值也先留 (最大 − 最小) × 5% 的余量再往下取整到单位；全是负数（最大值是 0）时最大值就是 0、不留余量
  // （COM 读自动刻度：−300~800 → −400~1000、−1~1 → −1.5~1.5、−5~−50 → −60~0、−120~40 → −140~60、−95~5 → −100~20）
  const neg = fixedMin === undefined && lo0 < 0 && !near;
  const loP = neg ? lo0 - pad : lo0, hiP = neg && hi0 <= 0 ? hi0 : hi0 + pad;
  const span = (fixedMax ?? hiP) - loP;
  const ends = (unit: number) => ({
    lo: fixedMin === undefined && (lo0 < 0 || near) ? Math.floor(Math.round((loP / unit) * 1e9) / 1e9) * unit : lo0,
    hi: fixedMax === undefined ? Math.ceil(Math.round((hiP / unit) * 1e9) / 1e9) * unit : hi0,
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

/** defLine：坐标轴线、网格线没写线条时的默认线（default-lines.ts） */
export function axisMaker(colors: ColorContext, baseText: TextStyle, part: string, lang = 'zh', defLine?: Line): AxisMaker {
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
      // 百分比堆积：自动范围就是 0~100%（有负数时从 −100% 起），不留余量（样本 COM 读 MaximumScale = 1）
      const pctMax = pct && fixedMax === undefined && vmax <= 1 ? 1 : fixedMax;
      const pctMin = pct && fixedMin === undefined ? (vmin < 0 ? -1 : 0) : fixedMin;
      const sc = niceScale(vmin, vmax, pctMin, pctMax, numAttr(child(ax, 'c:majorUnit'), 'val'), margin, maxLabels);
      ({ lo, hi } = sc);
      raw = (v) => (v - lo) / (hi - lo);
      // 刻度从最小值起按单位加（固定的最小值不是单位的整数倍时也是，样本：最小值 25、单位 2 → 25、27、29……），只去掉浮点误差
      const steps = (u: number) => Array.from({ length: Math.floor((hi - lo) / u + 1e-6) + 1 }, (_v, k) => +(lo + k * u).toPrecision(12));
      ticks.push(...steps(sc.unit));
      // 次要单位默认是主要单位的 1/5
      const mu = numAttr(child(ax, 'c:minorUnit'), 'val') ?? sc.unit / 5;
      if (child(ax, 'c:minorGridlines') || tickMark(ax, 'c:minorTickMark') !== 'none') {
        for (const r of steps(mu)) if (!ticks.some((t) => Math.abs(t - r) < mu * 1e-6)) minor.push(r);
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
      grid: g ? (defLine ? lineOrDefault(g, colors, part, defLine) : parseLine([child(child(g, 'c:spPr'), 'a:ln')], [colors], part) ?? { color: { r: 217, g: 217, b: 217, a: 1 }, width: 1, cap: 'butt', join: 'round' }) : undefined,
      minor,
      minorGrid: mg ? parseLine([child(child(mg, 'c:spPr'), 'a:ln')], [colors], part) ?? { color: { r: 242, g: 242, b: 242, a: 1 }, width: 1, cap: 'butt', join: 'round' } : undefined,
      axisLine: defLine ? lineOrDefault(ax, colors, part, defLine) : parseLine([child(child(ax, 'c:spPr'), 'a:ln')], [colors], part),
      majorMark: tickMark(ax, 'c:majorTickMark'), minorMark: tickMark(ax, 'c:minorTickMark'),
      lblPos: attr(child(ax, 'c:tickLblPos'), 'val') ?? 'nextTo',
      crosses: axisCrosses(ax),
      reversed,
      unitLabel: lblEl && divisor !== 1 ? { text: lblText, style: textStyle(child(lblEl, 'c:txPr'), colors, style) } : undefined,
      pos: reversed ? (v: number) => 1 - raw(v) : raw,
    };
  };
}
