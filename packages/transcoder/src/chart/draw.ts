/** 图表里共用的绘制工具：文字样式、文字标签、图例键、数据点标记、主题强调色 */
import { colorIn, css, type ColorContext, type Rgba } from '../model/color';
import { fallbackAdvance } from '../font/font';
import { esc, n2 } from '../common/svg';
import { attr, child, numAttr, path, type XEl } from '../io/xml';
import type { Series, TextStyle } from './model';

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

export function accentColor(i: number, colors: ColorContext): Rgba {
  return colorIn({ name: 'x', attrs: {}, text: '', children: [{ name: 'a:schemeClr', attrs: { val: ACCENTS[i % 6] }, children: [], text: '' }] }, colors)!;
}

export function legendKey(e: { color: Rgba; line: boolean; marker: boolean }, x: number, y: number, ks: number): string {
  if (e.line) {
    return `<line x1="${n2(x)}" y1="${n2(y)}" x2="${n2(x + ks * 3)}" y2="${n2(y)}" stroke="${css(e.color)}" stroke-width="2"/>`
      + (e.marker ? `<circle cx="${n2(x + ks * 1.5)}" cy="${n2(y)}" r="3" fill="${css(e.color)}"/>` : '');
  }
  if (e.marker) return `<circle cx="${n2(x + ks / 2)}" cy="${n2(y)}" r="3" fill="${css(e.color)}"/>`;
  return `<rect x="${n2(x)}" y="${n2(y - ks / 2)}" width="${n2(ks)}" height="${n2(ks)}" fill="${css(e.color)}"/>`;
}

/** 数据点标记（圆形；其它形状先都画成圆） */
export function markerSvg(s: Series, x: number, y: number): string {
  const fill = s.markerFill ?? s.line?.color;
  const stroke = s.markerLine;
  if (!fill && !stroke) return '';
  return `<circle cx="${n2(x)}" cy="${n2(y)}" r="${n2(s.markerSize / 2)}" fill="${fill ? css(fill) : 'none'}"${stroke ? ` stroke="${css(stroke)}" stroke-width="0.75"` : ''}/>`;
}
