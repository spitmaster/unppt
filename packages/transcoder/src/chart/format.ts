/** 图表里的数字 / 日期格式、数据标签文字、缓存数据读取 */
import { child, children, findAll, numAttr, type XEl } from '../io/xml';
import type { Labels } from './model';

/**
 * 数据标签的文字：系列名、类别名、数值、百分比按这个顺序，用 c:separator 隔开（没写时一般是", "，
 * 饼图是换行——实测）；pct 给了时用它（饼图按总和 100% 取整好的百分比）
 */
export function labelText(l: Labels, v: number, total: number, cat: string, ser: string, valFmt: string, pct?: number, sep = ', '): string {
  const parts: string[] = [];
  if (l.ser) parts.push(ser);
  if (l.cat) parts.push(cat);
  if (l.val) parts.push(formatNumber(v, l.fmt && l.fmt !== 'General' ? l.fmt : valFmt));
  if (l.pct) parts.push(`${pct ?? Math.round((total ? v / total : 0) * 100)}%`);
  return parts.join(l.sep ?? sep);
}

/**
 * 饼图各块的整数百分比：PowerPoint 让它们加起来正好 100%（实测 58.57/22.86/10/8.57 显示 58/23/10/9）——
 * 先都往下取整，差的几个百分点按小数部分从大到小补，小数部分一样时补给后面的
 */
export function piePercents(vals: number[]): number[] {
  const total = vals.reduce((a, b) => a + b, 0);
  if (!total) return vals.map(() => 0);
  const exact = vals.map((v) => (v / total) * 100);
  const out = exact.map((e) => Math.floor(e + 1e-9));
  let left = 100 - out.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => ({ i, r: e - Math.floor(e + 1e-9) })).sort((a, b) => (Math.abs(b.r - a.r) > 1e-9 ? b.r - a.r : b.i - a.i));
  for (const { i, r } of order) {
    if (left <= 0 || r < 1e-9) break;
    out[i]++;
    left--;
  }
  return out;
}

export function cacheValues(ref: XEl | undefined): { pts: Map<number, string>; count: number; format: string } {
  const cache = findAll(ref, 'c:numCache')[0] ?? findAll(ref, 'c:strCache')[0] ?? findAll(ref, 'c:numLit')[0] ?? findAll(ref, 'c:strLit')[0];
  const pts = new Map<number, string>();
  for (const pt of children(cache, 'c:pt')) pts.set(numAttr(pt, 'idx') ?? 0, child(pt, 'c:v')?.text ?? '');
  // 多级分类：取最后一级
  const multi = findAll(ref, 'c:multiLvlStrCache')[0];
  if (multi) {
    const lvls = children(multi, 'c:lvl');
    for (const pt of children(lvls[0], 'c:pt')) pts.set(numAttr(pt, 'idx') ?? 0, child(pt, 'c:v')?.text ?? '');
  }
  return { pts, count: numAttr(child(cache ?? multi, 'c:ptCount'), 'val') ?? pts.size, format: child(cache, 'c:formatCode')?.text ?? 'General' };
}

/** Excel 日期序号 -> 年/月/日 */
function excelDate(serial: number): Date {
  return new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
}

export function formatNumber(v: number, fmt: string): string {
  const f = fmt.toLowerCase();
  if (/[ymd]/.test(f) && !/general/.test(f)) {
    const d = excelDate(v);
    const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
    if (f.includes('d') && f.includes('m') && f.includes('y')) return `${y}/${m}/${day}`;
    if (f.includes('m') && f.includes('d')) return `${m}/${day}`;
    if (f.includes('y') && f.includes('m')) return `${y}/${m}`;
    return `${y}/${m}/${day}`;
  }
  if (f.includes('%')) {
    const dec = (f.split('.')[1] ?? '').replace(/[^0]/g, '').length;
    return `${(v * 100).toFixed(dec)}%`;
  }
  const m = /0\.(0+)/.exec(f);
  if (m) return v.toFixed(m[1].length);
  if (Number.isInteger(v)) return String(v);
  return String(Math.round(v * 1e6) / 1e6);
}
