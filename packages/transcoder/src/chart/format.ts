/** 图表里的数字 / 日期格式、数据标签文字、缓存数据读取 */
import { child, children, findAll, numAttr, type XEl } from '../io/xml';
import type { CatLevel, Labels } from './model';
import { formatDate } from './date-format';

/**
 * 数据标签的文字：系列名、类别名、数值、百分比按这个顺序，用 c:separator 隔开（没写时一般是", "，
 * 饼图是换行——实测）；pct 给了时用它（饼图按总和 100% 取整好的百分比）
 */
export function labelText(l: Labels, v: number, total: number, cat: string, ser: string, valFmt: string, pct?: number, sep = ', '): string {
  const p = labelParts(l, v, total, cat, valFmt, pct);
  const parts: string[] = [];
  if (l.ser) parts.push(ser);
  if (l.cat) parts.push(cat);
  if (l.val) parts.push(p.val);
  if (l.pct) parts.push(p.pct);
  return parts.join(l.sep ?? sep);
}

/** 标签里的几项（按格式写好的值、分类名、百分比），自定义文字的字段也用（point-labels.ts） */
export function labelParts(l: Labels, v: number, total: number, cat: string, valFmt: string, pct?: number): { val: string; cat: string; pct: string } {
  return { val: formatNumber(v, l.fmt && l.fmt !== 'General' ? l.fmt : valFmt), cat, pct: `${pct ?? Math.round((total ? v / total : 0) * 100)}%` };
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

export function cacheValues(ref: XEl | undefined): { pts: Map<number, string>; count: number; format: string; outer: CatLevel[] } {
  const cache = findAll(ref, 'c:numCache')[0] ?? findAll(ref, 'c:strCache')[0] ?? findAll(ref, 'c:numLit')[0] ?? findAll(ref, 'c:strLit')[0];
  const pts = new Map<number, string>();
  for (const pt of children(cache, 'c:pt')) pts.set(numAttr(pt, 'idx') ?? 0, child(pt, 'c:v')?.text ?? '');
  // 多级分类：第一级是最内层（每个分类的标签），后面的是外层的分组（从里往外）
  const multi = findAll(ref, 'c:multiLvlStrCache')[0];
  const outer: CatLevel[] = [];
  if (multi) {
    const lvls = children(multi, 'c:lvl');
    for (const pt of children(lvls[0], 'c:pt')) pts.set(numAttr(pt, 'idx') ?? 0, child(pt, 'c:v')?.text ?? '');
    for (const l of lvls.slice(1)) {
      outer.push(children(l, 'c:pt').map((pt) => ({ idx: numAttr(pt, 'idx') ?? 0, text: child(pt, 'c:v')?.text ?? '' })).sort((a, b) => a.idx - b.idx));
    }
  }
  return { pts, count: numAttr(child(cache ?? multi, 'c:ptCount'), 'val') ?? pts.size, format: child(cache, 'c:formatCode')?.text ?? 'General', outer };
}

/** 常规格式：整数原样，小数最多 6 位有效小数 */
function general(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return String(Math.round(v * 1e6) / 1e6);
}

/** 按分号分段（引号里的分号不算）：正数;负数;零;文字 */
function sections(fmt: string): string[] {
  const out: string[] = [];
  let cur = '', quoted = false;
  for (let i = 0; i < fmt.length; i++) {
    const c = fmt[i];
    if (c === '"') quoted = !quoted;
    if (c === '\\' && i + 1 < fmt.length) { cur += c + fmt[++i]; continue; }
    if (c === ';' && !quoted) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

/** 一段格式里的字面文字：引号里的、反斜杠转义的原样，"_x" 留一个空格的宽度，"*x" 填充不画；数字占位符换成 num */
function render(sec: string, num: string): string {
  let out = '', placed = false;
  for (let i = 0; i < sec.length; i++) {
    const c = sec[i];
    if (c === '"') { const j = sec.indexOf('"', i + 1); out += sec.slice(i + 1, j < 0 ? sec.length : j); i = j < 0 ? sec.length : j; continue; }
    if (c === '\\') { out += sec[++i] ?? ''; continue; }
    if (c === '_') { i++; out += ' '; continue; }
    if (c === '*') { i++; continue; }
    if ('#0?.,'.includes(c)) { if (!placed) { out += num; placed = true; } continue; }
    if (c === '%') { out += '%'; continue; }
    out += c;
  }
  return placed ? out : out + num;
}

/**
 * Excel 数字格式（图表的坐标轴、数据标签用）：按分号分段（负数用第二段、取绝对值），去掉 [Red]、[$-804] 这类方括号部分，
 * 日期时间（date-format.ts）、百分比、千分位、小数位、前后缀字面文字（引号、反斜杠、"_)" 留空）；数字后的逗号按千缩小
 */
export function formatNumber(v: number, fmt: string): string {
  if (!fmt || /^general$/i.test(fmt.trim())) return general(v);
  const secs = sections(fmt);
  let sec = secs[0], val = v, sign = '';
  if (v < 0) {
    if (secs.length > 1 && secs[1].trim()) { sec = secs[1]; val = -v; } else { sign = '-'; val = -v; }
  } else if (v === 0 && secs.length > 2 && secs[2].trim()) sec = secs[2];
  sec = sec.replace(/\[[^\]]*\]/g, '');
  const bare = sec.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/[_*]./g, '').toLowerCase();
  if (/general/.test(bare)) return sign + render(sec.replace(/general/i, '#'), general(val));
  if (/[ymdhs]/.test(bare) && !/[#0?]/.test(bare)) return formatDate(v, sec);
  const pat = /[#0?][#0?,]*(?:\.[#0?]*)?/.exec(bare)?.[0] ?? '';
  // 没有数字占位符的段（比如零值写成 "-"）只显示字面文字
  if (!pat && !bare.includes('%')) return render(sec, '');
  if (bare.includes('%')) val *= 100;
  const scale = /,+$/.exec(pat)?.[0].length ?? 0;
  if (scale) val /= 1000 ** scale;
  const [ip, dp = ''] = pat.replace(/,+$/, '').split('.');
  const zeros = (dp.match(/0/g) ?? []).length, opt = (dp.match(/[#?]/g) ?? []).length;
  let s = val.toFixed(zeros + opt);
  if (opt) s = s.replace(new RegExp(`0{1,${opt}}$`), '').replace(/\.$/, '');
  let [int, frac] = s.split('.');
  if (ip.includes(',')) int = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (int === '0' && !/0/.test(ip) && (frac || zeros)) int = '';
  return sign + render(sec, frac ? `${int}.${frac}` : int);
}
