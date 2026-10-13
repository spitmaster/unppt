/**
 * 分类轴图的两根坐标轴放在哪一侧、分类方向怎么换算，以及网格线、坐标轴线、刻度线的画法。
 * 规则（PowerPoint 实测，见 SPEC 第 7 节）：
 *   - 数值轴和分类轴交叉在第一个分类处（crosses = autoZero / min）或最后一个分类处（max）；分类轴逆序时第一个分类在另一头，
 *     所以"逆序类别"的条形图数值轴跑到上面；
 *   - 分类轴和数值轴交叉在数值 0（autoZero）、最小值、最大值或指定值处，分类标签在它旁边；数值轴逆序时最小值在另一头。
 */
import { css } from '../model/color';
import { n2 } from '../common/svg';
import { attr, child, type XEl } from '../io/xml';
import type { Line } from '../style/line';
import type { AxisInfo, Rect } from './model';

export type Side = 'l' | 'r' | 't' | 'b';
const OPP: Record<Side, Side> = { l: 'r', r: 'l', t: 'b', b: 't' };

/** 刻度线长度（像素，实测约 3 磅） */
const TICK = 4;

/** 刻度标签位置：nextTo / low / high / none */
export const tickLblPos = (ax: XEl | undefined) => attr(child(ax, 'c:tickLblPos'), 'val') ?? 'nextTo';

export interface Sides {
  /** 数值轴（标签）、分类轴（标签）各在哪一侧 */
  val: Side; cat: Side;
  /** 分类轴逆序 */
  catRev: boolean;
  /** 分类轴线所在的数值 */
  catCross: number;
  /** 分类轴线在绘图区中间（数值有正有负）：标签紧挨着它，原来那一侧不留标签带 */
  catMid: boolean;
}

export function axisSides(horizontal: boolean, catRev: boolean, val: AxisInfo, catCrosses: AxisInfo['crosses'], catLblPos: string): Sides {
  // 第一个分类所在的一侧
  const catStart: Side = horizontal ? (catRev ? 't' : 'b') : (catRev ? 'r' : 'l');
  let valSide: Side = val.crosses === 'max' ? OPP[catStart] : catStart;
  if (val.lblPos === 'low') valSide = catStart;
  else if (val.lblPos === 'high') valSide = OPP[catStart];
  // 分类轴所在的数值；数值最小的一端在哪一侧
  const clamp = (v: number) => Math.max(val.lo, Math.min(val.hi, v));
  const cross = catCrosses === 'min' ? val.lo : catCrosses === 'max' ? val.hi : typeof catCrosses === 'number' ? clamp(catCrosses) : clamp(0);
  const minSide: Side = horizontal ? (val.reversed ? 'r' : 'l') : (val.reversed ? 't' : 'b');
  // 分类轴交叉在最大值一端时标签在另一侧；交叉在中间（有负数）时标签挨着轴线、在它朝最小值的一侧
  let catSide = cross >= val.hi && val.hi > val.lo ? OPP[minSide] : minSide;
  if (catLblPos === 'low') catSide = minSide;
  else if (catLblPos === 'high') catSide = OPP[minSide];
  const catMid = catLblPos === 'nextTo' && cross > val.lo && cross < val.hi;
  return { val: valSide, cat: catSide, catRev, catCross: cross, catMid };
}

/** 分类方向的换算：从第一个分类的起点量起（逆序时从另一头量） */
export function catMapping(b: Rect, horizontal: boolean, rev: boolean): { catPx(d: number): number; catSpan(d: number, len: number): [number, number] } {
  if (!horizontal) {
    return rev
      ? { catPx: (d) => b.right - d, catSpan: (d, len) => [b.right - d - len, len] }
      : { catPx: (d) => b.left + d, catSpan: (d, len) => [b.left + d, len] };
  }
  return rev
    ? { catPx: (d) => b.top + d, catSpan: (d, len) => [b.top + d, len] }
    : { catPx: (d) => b.bottom - d, catSpan: (d, len) => [b.bottom - d - len, len] };
}

/** 一条网格线：柱形图是横线（v 是 y），条形图是竖线（v 是 x） */
export function gridLine(v: number, line: Line | undefined, horizontal: boolean, b: Rect): string {
  if (!line?.color) return '';
  return horizontal
    ? `<line x1="${n2(v)}" y1="${n2(b.top)}" x2="${n2(v)}" y2="${n2(b.bottom)}" stroke="${css(line.color)}" stroke-width="${n2(line.width)}"/>`
    : `<line x1="${n2(b.left)}" y1="${n2(v)}" x2="${n2(b.right)}" y2="${n2(v)}" stroke="${css(line.color)}" stroke-width="${n2(line.width)}"/>`;
}

/** 坐标轴线：dir 是轴的走向（h 横、v 竖），at 是它所在的 y（横）或 x（竖） */
export function axisLine(dir: 'h' | 'v', at: number, b: Rect, line: Line): string {
  return dir === 'h'
    ? `<line x1="${n2(b.left)}" y1="${n2(at)}" x2="${n2(b.right)}" y2="${n2(at)}" stroke="${css(line.color!)}" stroke-width="${n2(line.width)}"/>`
    : `<line x1="${n2(at)}" y1="${n2(b.top)}" x2="${n2(at)}" y2="${n2(b.bottom)}" stroke="${css(line.color!)}" stroke-width="${n2(line.width)}"/>`;
}

/** 坐标轴朝外的方向（+1 是往右 / 往下） */
export const outward = (s: Side) => (s === 'b' || s === 'r' ? 1 : -1);

/** 刻度线：kind 是 out（朝外）/ in（朝里）/ cross（穿过轴线）/ none；positions 是沿轴的坐标 */
export function tickMarks(positions: number[], at: number, dir: 'h' | 'v', sign: number, kind: string, line: Line): string {
  if (kind === 'none' || !positions.length) return '';
  const [a, b] = kind === 'cross' ? [-TICK, TICK] : kind === 'in' ? [0, -sign * TICK] : [0, sign * TICK];
  const d = positions.map((p) => (dir === 'h' ? `M${n2(p)} ${n2(at + a)}V${n2(at + b)}` : `M${n2(at + a)} ${n2(p)}H${n2(at + b)}`)).join('');
  return `<path d="${d}" fill="none" stroke="${css(line.color!)}" stroke-width="${n2(line.width)}"/>`;
}
