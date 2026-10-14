/** 图表区、绘图区的背景和边框（c:spPr）：纯色、渐变、图案填充和线条，画成一个矩形 */
import { css, type ColorContext } from '../model/color';
import { findFillEl, gradientPaint, parseFill } from '../style/fill';
import { patternFill } from '../style/pattern';
import { parseLine } from '../style/line';
import { n2, type SvgDoc } from '../common/svg';
import { child, type XEl } from '../io/xml';
import type { Rect } from './model';

/** spPr 写的背景和边框画成 r 范围的矩形；没有可画的返回空串。渐变、图案需要 doc（放定义），图案按 origin（图表在幻灯片上的位置）对齐幻灯片原点 */
export function areaRect(spPr: XEl | undefined, r: Rect, colors: ColorContext, part: string, doc?: SvgDoc, origin?: { x: number; y: number }): string {
  if (!spPr) return '';
  const w = r.right - r.left, h = r.bottom - r.top;
  if (w <= 0 || h <= 0) return '';
  const fill = parseFill(findFillEl(spPr), colors, part);
  const line = parseLine([child(spPr, 'a:ln')], [colors], part);
  let fa = '';
  if (fill?.kind === 'solid') fa = ` fill="${css(fill.color)}"${fill.color.a < 0.999 ? ` fill-opacity="${n2(fill.color.a)}"` : ''}`;
  else if (fill?.kind === 'grad' && doc) fa = ` fill="${gradientPaint(fill, doc, w, h, 'norm')}"`;
  else if (fill?.kind === 'pattern' && doc) {
    const id = patternFill(doc, fill.prst, fill.fg, fill.bg, { x: (origin?.x ?? 0) + r.left, y: (origin?.y ?? 0) + r.top });
    if (id) fa = ` fill="url(#${id})"`;
  }
  const sa = line?.color ? ` stroke="${css(line.color)}" stroke-width="${n2(line.width)}"` : '';
  if (!fa && !sa) return '';
  // 渐变按 (0, 0)-(w, h) 定义，矩形放在原点再整体平移
  return `<g transform="translate(${n2(r.left)} ${n2(r.top)})"><rect width="${n2(w)}" height="${n2(h)}"${fa || ' fill="none"'}${sa}/></g>`;
}
