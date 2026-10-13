/** 图表里的数字 / 日期格式、数据标签文字、缓存数据读取 */
import { child, children, findAll, numAttr, type XEl } from '../io/xml';
import type { Labels } from './model';

export function labelText(l: Labels, v: number, total: number, cat: string, ser: string, valFmt: string): string {
  const parts: string[] = [];
  if (l.ser) parts.push(ser);
  if (l.cat) parts.push(cat);
  if (l.val) parts.push(formatNumber(v, l.fmt && l.fmt !== 'General' ? l.fmt : valFmt));
  if (l.pct) parts.push(`${Math.round((total ? v / total : 0) * 100)}%`);
  return parts.join(', ');
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
