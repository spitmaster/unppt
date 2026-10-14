/**
 * 表格：列宽来自 a:tblGrid，行高取"设定行高"和"文字实际高度"的较大值；
 * 表格样式（ppt/tableStyles.xml）按 整表 -> 条纹 -> 首尾列 -> 首尾行 的顺序叠加，单元格自己的设置最后覆盖。
 * 样式里每个部分的边框作用在它自己的区域上：top/bottom/left/right 是区域的外边，insideH/insideV 是区域内部的边
 * （标题行的 bottom 就是标题行和正文之间那条线，压过整表的 insideH）。
 */
import { colorIn, type ColorContext } from '../model/color';
import { fillAttrs, findFillEl, parseFill, type Fill } from '../style/fill';
import { parseLine, strokeAttrs, type Line } from '../style/line';
import { EMU_PER_PX, type SlideContext } from '../model/model';
import { n2 } from '../common/svg';
import { renderText, type TextEnv } from '../text/text';
import { attr, child, children, numAttr, type XEl } from '../io/xml';
import type { FrameRenderer } from './frames/frame-handler';

const px = (v: number | undefined) => (v ?? 0) / EMU_PER_PX;

interface CellStyle { fill?: Fill; borders: Record<string, Line | undefined>; bold?: boolean; color?: XEl; }

async function tableStyles(r: FrameRenderer): Promise<XEl | undefined> {
  const pres = r.env.pres;
  const rel = await pres.pkg.relByType(pres.presPart, 'tableStyles');
  return rel ? pres.pkg.xml(rel.target) : undefined;
}

function partStyle(part: XEl | undefined, colors: ColorContext, ctx: SlideContext, theme: SlideContext['theme']): CellStyle {
  const s: CellStyle = { borders: {} };
  if (!part) return s;
  const tc = child(part, 'a:tcStyle');
  const fillEl = child(tc, 'a:fill');
  if (fillEl) s.fill = parseFill(findFillEl(fillEl), colors, ctx.part);
  const fillRef = child(tc, 'a:fillRef');
  if (fillRef) {
    const c = colorIn(fillRef, colors);
    const idx = numAttr(fillRef, 'idx') ?? 0;
    s.fill = parseFill(theme.fillStyles[idx - 1], { ...colors, placeholder: c }, ctx.part) ?? (c ? { kind: 'solid', color: c } : undefined);
  }
  const bdr = child(tc, 'a:tcBdr');
  for (const side of ['left', 'right', 'top', 'bottom', 'insideH', 'insideV', 'tl2br', 'tr2bl']) {
    const b = child(bdr, `a:${side}`);
    if (!b) continue;
    const ln = child(b, 'a:ln');
    s.borders[side] = parseLine([ln], [colors], ctx.part);
  }
  const tx = child(part, 'a:tcTxStyle');
  if (tx) {
    if (attr(tx, 'b') === 'on') s.bold = true;
    s.color = tx;
  }
  return s;
}

function mergeStyle(into: CellStyle, s: CellStyle) {
  if (s.fill) into.fill = s.fill;
  if (s.bold !== undefined) into.bold = s.bold;
  if (s.color) into.color = s.color;
}

/** 样式的一个部分和它作用的区域（行、列范围，含两端） */
interface StylePart { s: CellStyle; r0: number; r1: number; c0: number; c1: number }

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

/** origin 是表格在幻灯片上的位置（图案填充从幻灯片原点对齐） */
export async function renderTable(tbl: XEl | undefined, origin: { x: number; y: number }, r: FrameRenderer, ctx: SlideContext): Promise<string> {
  if (!tbl) return '';
  const colors = ctx.colors;
  const tblPr = child(tbl, 'a:tblPr');
  const flags = {
    firstRow: attr(tblPr, 'firstRow') === '1', lastRow: attr(tblPr, 'lastRow') === '1',
    firstCol: attr(tblPr, 'firstCol') === '1', lastCol: attr(tblPr, 'lastCol') === '1',
    bandRow: attr(tblPr, 'bandRow') === '1', bandCol: attr(tblPr, 'bandCol') === '1',
  };
  const styleId = child(tblPr, 'a:tableStyleId')?.text.trim();
  const styles = await tableStyles(r);
  const style = styleId ? children(styles, 'a:tblStyle').find((s) => attr(s, 'styleId') === styleId) : undefined;
  if (styleId && !style) r.env.pres.warn('表格样式缺失');

  const cols = children(child(tbl, 'a:tblGrid'), 'a:gridCol').map((c) => px(numAttr(c, 'w')));
  const rows = children(tbl, 'a:tr');
  const nR = rows.length, nC = cols.length;
  const colX = [0];
  for (const c of cols) colX.push(colX[colX.length - 1] + c);

  // 每个单元格用到的样式部分（按叠加顺序）和合成的样式
  const get = (name: string) => partStyle(child(style, `a:${name}`), colors, ctx, ctx.theme);
  const stylePartsOf = (ri: number, ci: number): StylePart[] => {
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
    return parts;
  };
  const cellStyle = (ri: number, ci: number, rowSpan = 1, span = 1): CellStyle => {
    const parts = stylePartsOf(ri, ci);
    const s: CellStyle = { borders: cellBorders(parts, ri, ci, rowSpan, span) };
    for (const p of parts) mergeStyle(s, p.s);
    return s;
  };

  // 第一遍：排文字，算行高
  interface Cell { ri: number; ci: number; span: number; rowSpan: number; tc: XEl; style: CellStyle; text?: string; textH: number; }
  // 单元格文字的基线也对齐整像素：以表格左上角为原点（坐标系没缩放、没转动时）
  const m = ctx.toSlide === undefined ? { x: 0, y: 0, sx: 1, sy: 1 } : ctx.toSlide;
  const pixelTop = m && m.sy === 1 ? m.y + origin.y : undefined;
  const env: TextEnv = { colors, theme: ctx.theme, fonts: r.env.fonts, missingFonts: r.env.missingFonts, embed: r.env.embed, doc: r.doc, images: r.images, part: ctx.part, pixelTop };
  /** 排一个单元格的文字：表格样式的加粗和文字颜色作为最底层的默认值，单元格边距来自 tcPr */
  const cellText = (c: Cell, box: { x: number; y: number; w: number; h: number }, out?: { height: number }) => {
    const tcPr = child(c.tc, 'a:tcPr');
    const colorEls = (c.style.color?.children ?? [])
      .filter((k) => k.name.endsWith('Clr') || k.name === 'a:fontRef')
      .map((k): XEl => ({ name: 'a:solidFill', attrs: {}, text: '', children: k.name === 'a:fontRef' ? k.children : [k] }));
    const defaults: XEl = { name: 'x', attrs: {}, text: '', children: [{ name: 'a:lvl1pPr', attrs: {}, text: '', children: [{ name: 'a:defRPr', attrs: c.style.bold ? { b: '1' } : {}, text: '', children: colorEls }] }] };
    const bodyPr: XEl = {
      name: 'a:bodyPr', text: '', children: [],
      attrs: {
        lIns: attr(tcPr, 'marL') ?? '91440', rIns: attr(tcPr, 'marR') ?? '91440',
        tIns: attr(tcPr, 'marT') ?? '45720', bIns: attr(tcPr, 'marB') ?? '45720',
        anchor: attr(tcPr, 'anchor') ?? 't',
        // 单元格的文字方向（竖排等），和文本框的 vert 取值相同
        ...(attr(tcPr, 'vert') ? { vert: attr(tcPr, 'vert')! } : {}),
      },
    };
    return renderText(child(c.tc, 'a:txBody'), [r.env.pres.defaultTextStyle, defaults], [bodyPr], box, env, out);
  };
  const cells: Cell[] = [];
  const rowH = rows.map((tr) => px(numAttr(tr, 'h')));
  for (let ri = 0; ri < nR; ri++) {
    const tcs = children(rows[ri], 'a:tc');
    for (let ci = 0; ci < tcs.length && ci < nC; ci++) {
      const tc = tcs[ci];
      if (attr(tc, 'hMerge') === '1' || attr(tc, 'vMerge') === '1') continue;
      const span = numAttr(tc, 'gridSpan') ?? 1;
      const rowSpan = numAttr(tc, 'rowSpan') ?? 1;
      const style = cellStyle(ri, ci, rowSpan, span);
      const cell: Cell = { ri, ci, span, rowSpan, tc, style, textH: 0 };
      cells.push(cell);
      const w = colX[Math.min(nC, ci + span)] - colX[ci];
      const out = { height: 0 };
      cell.text = await cellText(cell, { x: 0, y: 0, w, h: rowH[ri] }, out);
      cell.textH = out.height;
      if (rowSpan === 1 && out.height > rowH[ri]) rowH[ri] = out.height;
    }
  }
  const rowY = [0];
  for (const h of rowH) rowY.push(rowY[rowY.length - 1] + h);

  // 第二遍：输出（文字在上一步按设定行高排的，行高变了要重排）
  const fills: string[] = [];
  const texts: string[] = [];
  const borders: string[] = [];
  for (const c of cells) {
    const x = colX[c.ci], y = rowY[c.ri];
    const w = colX[Math.min(nC, c.ci + c.span)] - x;
    const h = rowY[Math.min(nR, c.ri + c.rowSpan)] - y;
    const tcPr = child(c.tc, 'a:tcPr');
    const own = parseFill(findFillEl(tcPr), colors, ctx.part);
    const fill = own ?? c.style.fill;
    if (fill && fill.kind === 'solid') fills.push(`<rect x="${n2(x)}" y="${n2(y)}" width="${n2(w)}" height="${n2(h)}"${await fillAttrs(fill, r.doc, w, h, 'norm', r.images)}/>`);
    else if (fill && fill.kind !== 'none') {
      // 渐变、图片、图案的坐标以单元格左上角为原点
      const fa = await fillAttrs(fill, r.doc, w, h, 'norm', r.images, { x: origin.x + x, y: origin.y + y });
      fills.push(`<g transform="translate(${n2(x)} ${n2(y)})"><rect width="${n2(w)}" height="${n2(h)}"${fa}/></g>`);
    }
    // 文字：行高可能被撑高了，按最终高度重排（垂直对齐需要）
    if (c.text) texts.push(await cellText(c, { x, y, w, h }));
    // 边框：单元格自己的 lnL/lnR/lnT/lnB 优先，否则用表格样式
    const side = (own: string, styleSide: Line | undefined) => {
      const ln = child(tcPr, own);
      if (ln) return parseLine([ln], [colors], ctx.part);
      return styleSide;
    };
    const sb = c.style.borders;
    const left = side('a:lnL', sb.left);
    const right = side('a:lnR', sb.right);
    const top = side('a:lnT', sb.top);
    const bottom = side('a:lnB', sb.bottom);
    const seg = (l: Line | undefined, x1: number, y1: number, x2: number, y2: number) => {
      if (l) borders.push(`<line x1="${n2(x1)}" y1="${n2(y1)}" x2="${n2(x2)}" y2="${n2(y2)}"${strokeAttrs({ ...l, head: undefined, tail: undefined }, r.doc, 'norm')}/>`);
    };
    seg(top, x, y, x + w, y);
    seg(bottom, x, y + h, x + w, y + h);
    seg(left, x, y, x, y + h);
    seg(right, x + w, y, x + w, y + h);
    // 斜线表头：左上到右下、左下到右上
    seg(side('a:lnTlToBr', sb.tl2br), x, y, x + w, y + h);
    seg(side('a:lnBlToTr', sb.tr2bl), x, y + h, x + w, y);
  }
  return fills.join('') + borders.join('') + texts.join('');
}
