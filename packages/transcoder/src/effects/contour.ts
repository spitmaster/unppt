/**
 * 三维轮廓（a:sp3d 的 contourW / contourClr）：正视时就是贴着外框的一圈。
 * 实测（COM 生成矩形量 4 倍导出图）：没有边线、没有棱台时以外框为中心、宽 contourW，盖在填充上；
 * 有边线时中心在边线外沿（盖在边线外侧一半上），有棱台时内侧一半被斜面盖住——这两种只露出外框以外的部分。
 */
import { colorIn, css, type ColorContext } from '../model/color';
import { EMU_PER_PX } from '../model/model';
import { n2 } from '../common/svg';
import { child, numAttr, type XEl } from '../io/xml';

export interface ContourDoc { id(prefix: string): string; addDef(xml: string): void }

/** outline 是形状填充区域的路径（框内坐标，宽 w 高 h）；没有轮廓时返回空串 */
export function contour(sp3d: XEl | undefined, colors: ColorContext, outline: string, lineWidth: number, w: number, h: number, doc: ContourDoc): string {
  const cw = (numAttr(sp3d, 'contourW') ?? 0) / EMU_PER_PX;
  const c = cw > 0 && outline ? colorIn(child(sp3d, 'a:contourClr'), colors) : undefined;
  if (!c) return '';
  const paint = ` fill="none" stroke-linejoin="round" stroke="${css(c)}"${c.a < 0.999 ? ` stroke-opacity="${n2(c.a)}"` : ''}`;
  if (!lineWidth && !child(sp3d, 'a:bevelT')) return `<path d="${outline}"${paint} stroke-width="${n2(cw)}"/>`;
  // 只露出外框以外：线宽 = 边线宽 + 轮廓宽，用遮罩挖掉形状内部
  const sw = lineWidth + cw, pad = sw;
  const id = doc.id('ct');
  doc.addDef(`<mask id="${id}" maskUnits="userSpaceOnUse" x="${n2(-pad)}" y="${n2(-pad)}" width="${n2(w + 2 * pad)}" height="${n2(h + 2 * pad)}">`
    + `<rect x="${n2(-pad)}" y="${n2(-pad)}" width="${n2(w + 2 * pad)}" height="${n2(h + 2 * pad)}" fill="#fff"/><path d="${outline}" fill="#000"/></mask>`);
  return `<path d="${outline}"${paint} stroke-width="${n2(sw)}" mask="url(#${id})"/>`;
}
