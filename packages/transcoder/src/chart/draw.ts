/** 图表里共用的绘制工具：文字样式、文字标签、图例键、数据点标记、主题强调色 */
import { colorIn, css, type ColorContext, type Rgba } from '../model/color';
import { fallbackAdvance } from '../font/font';
import { esc, n2 } from '../common/svg';
import { attr, child, numAttr, path, type XEl } from '../io/xml';
import type { GradFill, Series, SvgDefs, TextStyle } from './model';
import type { Line } from '../style/line';
import { gradientStops } from '../style/gradient-stops';

export const ACCENTS = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];

export function textStyle(txPr: XEl | undefined, ctx: ColorContext, base: TextStyle): TextStyle {
  const def = path(txPr, 'a:p', 'a:pPr', 'a:defRPr');
  if (!def) return base;
  const sz = numAttr(def, 'sz');
  const fill = child(def, 'a:solidFill');
  const latin = attr(child(def, 'a:latin'), 'typeface');
  return {
    size: sz ? (sz / 100) * 96 / 72 : base.size,
    color: (fill && colorIn(fill, ctx)) || base.color,
    bold: attr(def, 'b') === '1' ? true : attr(def, 'b') === '0' ? false : base.bold,
    font: latin && !latin.startsWith('+') ? latin : base.font,
  };
}

export function textWidth(s: string, size: number): number {
  let w = 0;
  for (const ch of s) w += fallbackAdvance(ch.codePointAt(0)!);
  return w * size;
}

export function label(s: string, x: number, y: number, st: TextStyle, anchor: 'start' | 'middle' | 'end' = 'middle', baseline: 'central' | 'auto' = 'central'): string {
  return `<text x="${n2(x)}" y="${n2(y)}" font-size="${n2(st.size)}" font-family="'${esc(st.font)}',sans-serif" fill="${css(st.color)}"${st.bold ? ' font-weight="bold"' : ''} text-anchor="${anchor}"${baseline === 'central' ? ' dominant-baseline="central"' : ''}>${esc(s)}</text>`;
}

/** 文字里有中日韩字符（这类标签占的高度比纯数字、字母的大，见 layout.ts） */
export const hasCjk = (s: string) => /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(s);

export function accentColor(i: number, colors: ColorContext): Rgba {
  return colorIn({ name: 'x', attrs: {}, text: '', children: [{ name: 'a:schemeClr', attrs: { val: ACCENTS[i % 6] }, children: [], text: '' }] }, colors)!;
}

/**
 * 图例键：柱/面积是色块，折线是一段线（可带标记），散点等只有标记。
 * wide 给了时键统一是这么宽：线画满、标记居中、色块变成 wide × ks 的扁条；不给时线长 3ks、色块 ks × ks
 */
export function legendKey(e: { color: Rgba; line: boolean; marker: boolean; series?: Series; width?: number; dash?: string; paint?: string; stroke?: string }, x: number, y: number, ks: number, wide?: number): string {
  // 图例里的标记最大 8 像素
  const mark = (cx: number) => (e.series ? markerSvg(e.series, cx, y, 8) : `<circle cx="${n2(cx)}" cy="${n2(y)}" r="3" fill="${css(e.color)}"/>`);
  const len = wide ?? ks * 3;
  if (e.line) {
    return `<line x1="${n2(x)}" y1="${n2(y)}" x2="${n2(x + len)}" y2="${n2(y)}" stroke="${css(e.color)}" stroke-width="${n2(e.width ?? 2)}"${e.dash ?? ''}${e.dash ? ' stroke-linecap="round"' : ''}/>`
      + (e.marker ? mark(x + len / 2) : '');
  }
  if (e.marker) return mark(x + (wide ?? ks) / 2);
  return `<rect x="${n2(x)}" y="${n2(y - ks / 2)}" width="${n2(wide ?? ks)}" height="${n2(ks)}" fill="${e.paint ?? css(e.color)}"${e.stroke ?? ''}/>`;
}

/** 数据点标记：按系列的形状、大小、填充色和边框色画（maxSize 用于图例里缩小） */
export function markerSvg(s: Series, x: number, y: number, maxSize = Infinity): string {
  const fill = s.markerFill ?? s.line?.color;
  const stroke = s.markerLine;
  if (!fill && !stroke) return '';
  const d = Math.min(s.markerSize, maxSize), r = d / 2;
  const f = ` fill="${fill ? css(fill) : 'none'}"`;
  const st = stroke ? ` stroke="${css(stroke)}" stroke-width="0.75"` : '';
  // 只有线条的标记（X、星形、加号、短横线）用标记的边框色，没有就用填充色
  const lineOnly = ` fill="none" stroke="${css(stroke ?? fill!)}" stroke-width="${n2(Math.max(1, d / 8))}"`;
  const P = (pts: [number, number][]) => pts.map(([px, py]) => `${n2(x + px)},${n2(y + py)}`).join(' ');
  switch (s.markerSymbol) {
    case 'square': return `<rect x="${n2(x - r)}" y="${n2(y - r)}" width="${n2(d)}" height="${n2(d)}"${f}${st}/>`;
    case 'diamond': return `<polygon points="${P([[0, -r], [r, 0], [0, r], [-r, 0]])}"${f}${st}/>`;
    case 'triangle': return `<polygon points="${P([[0, -r], [r, r], [-r, r]])}"${f}${st}/>`;
    case 'x': return `<path d="M${n2(x - r)} ${n2(y - r)}L${n2(x + r)} ${n2(y + r)}M${n2(x + r)} ${n2(y - r)}L${n2(x - r)} ${n2(y + r)}"${lineOnly}/>`;
    case 'star': return `<path d="M${n2(x - r)} ${n2(y - r)}L${n2(x + r)} ${n2(y + r)}M${n2(x + r)} ${n2(y - r)}L${n2(x - r)} ${n2(y + r)}M${n2(x)} ${n2(y - r)}L${n2(x)} ${n2(y + r)}"${lineOnly}/>`;
    case 'plus': return `<path d="M${n2(x - r)} ${n2(y)}L${n2(x + r)} ${n2(y)}M${n2(x)} ${n2(y - r)}L${n2(x)} ${n2(y + r)}"${lineOnly}/>`;
    case 'dash': return `<path d="M${n2(x - r)} ${n2(y)}L${n2(x + r)} ${n2(y)}"${lineOnly}/>`;
    case 'dot': return `<rect x="${n2(x - r)}" y="${n2(y - d / 16)}" width="${n2(d)}" height="${n2(d / 8)}"${f}/>`;
    default: return `<circle cx="${n2(x)}" cy="${n2(y)}" r="${n2(r)}"${f}${st}/>`;
  }
}

/**
 * 折线的路径。平滑线用三次贝塞尔曲线连接：控制点取前后两点连线的 1/6（Catmull-Rom），
 * 两端外面补一个关于端点对称的点（实测：首尾两段这样吻合到 1 像素，只重复端点会差 3~4 像素）
 */
export function linePath(pts: readonly (readonly [number, number])[], smooth: boolean): string {
  if (!smooth || pts.length < 3) return `M${pts.map((q) => `${n2(q[0])} ${n2(q[1])}`).join('L')}`;
  const n = pts.length;
  const at = (i: number): readonly [number, number] => (i < 0 ? [2 * pts[0][0] - pts[1][0], 2 * pts[0][1] - pts[1][1]]
    : i >= n ? [2 * pts[n - 1][0] - pts[n - 2][0], 2 * pts[n - 1][1] - pts[n - 2][1]] : pts[i]);
  let d = `M${n2(pts[0][0])} ${n2(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${n2(c1[0])} ${n2(c1[1])} ${n2(c2[0])} ${n2(c2[1])} ${n2(p2[0])} ${n2(p2[1])}`;
  }
  return d;
}

/**
 * 数据部分（"按系列""按类别"动画的目标）：key 是"系列序号x分类序号"（柱、扇区、标记），
 * "系列序号s"（整条折线、面积），数据标签再加 l。图表框把它换成动画编号（拼法见 common/uid.ts）
 */
export const cpart = (key: string, svg: string) => (svg ? `<g data-cpart="${key}">${svg}</g>` : '');

/**
 * 系列（或单个数据点）的线性渐变写成 SVG 定义，返回 url(#…)：按每个柱子、扇区自己的外框铺满（objectBoundingBox，
 * 角度在单位正方形里算，相当于 PowerPoint 的"随形状缩放"），色标按 PowerPoint 的插值规律（style/gradient-stops.ts）
 */
export function gradientRef(g: GradFill, defs: SvgDefs): string {
  const t = (g.angle * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const L = (Math.abs(c) + Math.abs(s)) / 2;
  const id = defs.id('cg');
  defs.add(`<linearGradient id="${id}" x1="${n2(0.5 - c * L)}" y1="${n2(0.5 - s * L)}" x2="${n2(0.5 + c * L)}" y2="${n2(0.5 + s * L)}">${gradientStops(g.stops)}</linearGradient>`);
  return `url(#${id})`;
}

/** 第 i 个数据点的填充写法：数据点自己的渐变 > 数据点自己的纯色 > 系列的渐变 > color */
export function paintOf(s: Series, i: number, color: Rgba): string {
  return s.pointPaints?.get(i) ?? (s.pointFills.has(i) ? css(color) : s.paint ?? css(color));
}

/** 第 i 个数据点的边框（柱子、扇区）：数据点自己写的 > 系列的；没有时返回 undefined，fallback 是都没写时用的（饼图的白线） */
export function strokeOf(s: Series, i: number, fallback?: Line): string {
  const pl = s.pointLines?.get(i);
  const ln = pl !== undefined ? pl : s.noLine ? null : s.line ?? fallback ?? null;
  return ln?.color ? ` stroke="${css(ln.color)}" stroke-width="${n2(ln.width)}"` : '';
}

/** 多行标签（文字里有换行）：每行居中对齐，行距 1.44 × 字号（实测饼图标签），整体以 (x, y) 为中心 */
export function multiLabel(s: string, x: number, y: number, st: TextStyle, anchor: 'start' | 'middle' | 'end' = 'middle'): string {
  const lines = s.split('\n');
  if (lines.length === 1) return label(s, x, y, st, anchor);
  const pitch = 1.44 * st.size;
  return lines.map((t, k) => label(t, x, y + (k - (lines.length - 1) / 2) * pitch, st, anchor)).join('');
}
