/**
 * 表格样式（ppt/tableStyles.xml 里的 a:tblStyle）：
 *   - 叠加顺序：整表 -> 条纹（行、列）-> 首尾列 -> 首尾行 -> 四个角的单元格（nwCell / neCell / swCell / seCell，
 *     首行和首列都打开时左上角是 nwCell，依此类推），单元格自己的设置最后覆盖（table.ts）；
 *   - 每个部分的边框作用在它自己的区域上：top/bottom/left/right 是区域的外边，insideH/insideV 是区域内部的边
 *     （标题行的 bottom 就是标题行和正文之间那条线，压过整表的 insideH）；边框可以直接写线条（a:ln），
 *     也可以引用主题的线条样式（a:lnRef，"主题样式"系列就是这样）；
 *   - 整表背景（a:tblBg）：铺在所有单元格下面的填充（直接写或 a:fillRef 引用主题填充样式），
 *     a:effectRef 引用主题的效果样式（阴影等），作用在整张表上。
 */
import { colorIn, type ColorContext } from '../model/color';
import { findFillEl, parseFill, styleRef, type Fill } from '../style/fill';
import { parseLine, type Line } from '../style/line';
import type { SlideContext } from '../model/model';
import { attr, child, children, numAttr, type XEl } from '../io/xml';

export interface CellStyle { fill?: Fill; borders: Record<string, Line | undefined>; bold?: boolean; color?: XEl }

/** 样式的一个部分和它作用的区域（行、列范围，含两端） */
interface StylePart { s: CellStyle; r0: number; r1: number; c0: number; c1: number }

export interface TableFlags { firstRow: boolean; lastRow: boolean; firstCol: boolean; lastCol: boolean; bandRow: boolean; bandCol: boolean }

export function tableFlags(tblPr: XEl | undefined): TableFlags {
  const on = (k: string) => attr(tblPr, k) === '1';
  return { firstRow: on('firstRow'), lastRow: on('lastRow'), firstCol: on('firstCol'), lastCol: on('lastCol'), bandRow: on('bandRow'), bandCol: on('bandCol') };
}

/** 填充：直接写的 a:fill，或者 a:fillRef 引用主题填充样式（颜色作为样式里的占位色） */
function styleFill(el: XEl | undefined, colors: ColorContext, ctx: SlideContext): Fill | undefined {
  const fillEl = child(el, 'a:fill');
  if (fillEl) return parseFill(findFillEl(fillEl), colors, ctx.part);
  const fillRef = child(el, 'a:fillRef');
  if (!fillRef) return undefined;
  const c = colorIn(fillRef, colors);
  const idx = numAttr(fillRef, 'idx') ?? 0;
  return parseFill(ctx.theme.fillStyles[idx - 1], { ...colors, placeholder: c }, ctx.part) ?? (c ? { kind: 'solid', color: c } : undefined);
}

function partStyle(part: XEl | undefined, colors: ColorContext, ctx: SlideContext): CellStyle {
  const s: CellStyle = { borders: {} };
  if (!part) return s;
  const tc = child(part, 'a:tcStyle');
  s.fill = styleFill(tc, colors, ctx);
  const bdr = child(tc, 'a:tcBdr');
  for (const side of ['left', 'right', 'top', 'bottom', 'insideH', 'insideV', 'tl2br', 'tr2bl']) {
    const b = child(bdr, `a:${side}`);
    if (!b) continue;
    const ln = child(b, 'a:ln');
    if (ln) s.borders[side] = parseLine([ln], [colors], ctx.part);
    else if (child(b, 'a:lnRef')) {
      const ref = styleRef(child(b, 'a:lnRef'), ctx.theme.lineStyles, colors);
      s.borders[side] = parseLine([ref.el], [ref.ctx], ctx.part);
    }
  }
  const tx = child(part, 'a:tcTxStyle');
  if (tx) {
    if (attr(tx, 'b') === 'on') s.bold = true;
    // 只写了加粗、没写颜色的部分不改颜色
    if (tx.children.length) s.color = tx;
  }
  return s;
}

function mergeStyle(into: CellStyle, s: CellStyle) {
  if (s.fill) into.fill = s.fill;
  if (s.bold !== undefined) into.bold = s.bold;
  if (s.color) into.color = s.color;
}

/** 单元格四条边（和两条斜线）的边框：按部分的先后，后面的部分写了这条边就覆盖前面的（写了"无线条"也算） */
function cellBorders(parts: StylePart[], ri: number, ci: number, rowSpan: number, span: number): Record<string, Line | undefined> {
  const out: Record<string, Line | undefined> = {};
  const rb = ri + rowSpan - 1, cr = ci + span - 1;
  const take = (edge: string, b: Record<string, Line | undefined>, key: string) => { if (key in b) out[edge] = b[key]; };
  for (const { s, r0, r1, c0, c1 } of parts) {
    if (ri > r1 || rb < r0 || ci > c1 || cr < c0) continue;
    const b = s.borders;
    take('top', b, ri === r0 ? 'top' : 'insideH');
    take('bottom', b, rb === r1 ? 'bottom' : 'insideH');
    take('left', b, ci === c0 ? 'left' : 'insideV');
    take('right', b, cr === c1 ? 'right' : 'insideV');
    take('tl2br', b, 'tl2br');
    take('tr2bl', b, 'tr2bl');
  }
  return out;
}

/** 一张表的样式：给出每个单元格合成后的样式 */
export function tableStyleOf(style: XEl | undefined, flags: TableFlags, nR: number, nC: number, colors: ColorContext, ctx: SlideContext) {
  const cache = new Map<string, CellStyle>();
  const get = (name: string) => {
    let s = cache.get(name);
    if (!s) cache.set(name, (s = partStyle(child(style, `a:${name}`), colors, ctx)));
    return s;
  };
  const partsOf = (ri: number, ci: number): StylePart[] => {
    const parts: StylePart[] = [{ s: get('wholeTbl'), r0: 0, r1: nR - 1, c0: 0, c1: nC - 1 }];
    if (flags.bandRow) {
      const idx = ri - (flags.firstRow ? 1 : 0);
      if (idx >= 0) parts.push({ s: get(idx % 2 === 0 ? 'band1H' : 'band2H'), r0: ri, r1: ri, c0: 0, c1: nC - 1 });
    }
    if (flags.bandCol) {
      const idx = ci - (flags.firstCol ? 1 : 0);
      if (idx >= 0) parts.push({ s: get(idx % 2 === 0 ? 'band1V' : 'band2V'), r0: 0, r1: nR - 1, c0: ci, c1: ci });
    }
    if (flags.firstCol && ci === 0) parts.push({ s: get('firstCol'), r0: 0, r1: nR - 1, c0: 0, c1: 0 });
    if (flags.lastCol && ci === nC - 1) parts.push({ s: get('lastCol'), r0: 0, r1: nR - 1, c0: nC - 1, c1: nC - 1 });
    if (flags.firstRow && ri === 0) parts.push({ s: get('firstRow'), r0: 0, r1: 0, c0: 0, c1: nC - 1 });
    if (flags.lastRow && ri === nR - 1) parts.push({ s: get('lastRow'), r0: nR - 1, r1: nR - 1, c0: 0, c1: nC - 1 });
    // 四个角：所在的首/末行和首/末列都打开时才用
    const corner = (name: string, row: boolean, col: boolean, r: number, c: number) => {
      if (row && col && ri === r && ci === c) parts.push({ s: get(name), r0: r, r1: r, c0: c, c1: c });
    };
    corner('nwCell', flags.firstRow, flags.firstCol, 0, 0);
    corner('neCell', flags.firstRow, flags.lastCol, 0, nC - 1);
    corner('swCell', flags.lastRow, flags.firstCol, nR - 1, 0);
    corner('seCell', flags.lastRow, flags.lastCol, nR - 1, nC - 1);
    return parts;
  };
  return (ri: number, ci: number, rowSpan = 1, span = 1): CellStyle => {
    const parts = partsOf(ri, ci);
    const s: CellStyle = { borders: cellBorders(parts, ri, ci, rowSpan, span) };
    for (const p of parts) mergeStyle(s, p.s);
    return s;
  };
}

/** 整表背景：填充，以及效果（主题效果样式里的 a:effectLst 和它的配色） */
export function tableBackground(style: XEl | undefined, colors: ColorContext, ctx: SlideContext): { fill?: Fill; effect?: { lst: XEl; colors: ColorContext } } {
  const bg = child(style, 'a:tblBg');
  if (!bg) return {};
  const ref = styleRef(child(bg, 'a:effectRef'), ctx.theme.effectStyles, colors);
  const lst = child(ref.el, 'a:effectLst');
  return { fill: styleFill(bg, colors, ctx), effect: lst?.children.length ? { lst, colors: ref.ctx } : undefined };
}

/** 读 ppt/tableStyles.xml 里的样式 */
export function findTableStyle(styles: XEl | undefined, styleId: string | undefined): XEl | undefined {
  return styleId ? children(styles, 'a:tblStyle').find((s) => attr(s, 'styleId') === styleId) : undefined;
}
