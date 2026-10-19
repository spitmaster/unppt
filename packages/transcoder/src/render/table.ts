/**
 * 表格：列宽来自 a:tblGrid，行高取"设定行高"和"文字实际高度"的较大值；表格样式见 table-style.ts，
 * 单元格自己的填充、边框（tcPr）最后覆盖。
 */
import { fillAttrs, findFillEl, parseFill } from '../style/fill';
import { parseLine, strokeAttrs, type Line } from '../style/line';
import { EMU_PER_PX, type SlideContext } from '../model/model';
import { pixelRow } from './pixel-snap';
import { n2 } from '../common/svg';
import { renderText, type TextEnv } from '../text/text';
import { styleFonts } from '../text/style';
import { attr, child, children, numAttr, type XEl } from '../io/xml';
import { effectFilter } from '../effects/effect-filter';
import { findTableStyle, tableBackground, tableFlags, tableStyleOf, type CellStyle } from './table-style';
import type { FrameRenderer } from './frames/frame-handler';

const px = (v: number | undefined) => (v ?? 0) / EMU_PER_PX;

async function tableStyles(r: FrameRenderer): Promise<XEl | undefined> {
  const pres = r.env.pres;
  const rel = await pres.pkg.relByType(pres.presPart, 'tableStyles');
  return rel ? pres.pkg.xml(rel.target) : undefined;
}

/** origin 是表格在幻灯片上的位置（图案填充从幻灯片原点对齐） */
export async function renderTable(tbl: XEl | undefined, origin: { x: number; y: number }, r: FrameRenderer, ctx: SlideContext): Promise<string> {
  if (!tbl) return '';
  const colors = ctx.colors;
  const tblPr = child(tbl, 'a:tblPr');
  const flags = tableFlags(tblPr);
  const styleId = child(tblPr, 'a:tableStyleId')?.text.trim();
  const style = findTableStyle(await tableStyles(r), styleId);
  if (styleId && !style) r.env.pres.warn('表格样式缺失');

  const cols = children(child(tbl, 'a:tblGrid'), 'a:gridCol').map((c) => px(numAttr(c, 'w')));
  const rows = children(tbl, 'a:tr');
  const nR = rows.length, nC = cols.length;
  const colX = [0];
  for (const c of cols) colX.push(colX[colX.length - 1] + c);

  // 每个单元格合成的样式（table-style.ts）
  const cellStyle = tableStyleOf(style, flags, nR, nC, colors, ctx);

  // 第一遍：排文字，算行高
  interface Cell { ri: number; ci: number; span: number; rowSpan: number; tc: XEl; style: CellStyle; text?: string; textH: number; }
  // 单元格文字的基线也对齐整像素：以表格左上角为原点（坐标系没缩放、没转动时）
  const row = pixelRow(ctx.toSlide, origin.y, r.env.pres.displayScale);
  const env: TextEnv = { colors, theme: ctx.theme, fonts: r.env.fonts, missingFonts: r.env.missingFonts, fontCharsets: ctx.fontCharsets, embed: r.env.embed, doc: r.doc, images: r.images, part: ctx.part, slideNumber: ctx.slideNumber, ...row };
  /** 排一个单元格的文字：表格样式的加粗和文字颜色作为最底层的默认值，单元格边距来自 tcPr */
  const cellText = (c: Cell, box: { x: number; y: number; w: number; h: number }, out?: { height: number }) => {
    const tcPr = child(c.tc, 'a:tcPr');
    // 文字颜色：直接写的颜色优先，没有时用 fontRef 里的颜色
    const tx = c.style.color?.children ?? [];
    const clr = tx.find((k) => k.name.endsWith('Clr')) ?? tx.find((k) => k.name === 'a:fontRef')?.children[0];
    const colorEls: XEl[] = clr ? [{ name: 'a:solidFill', attrs: {}, text: '', children: [clr] }] : [];
    // 字体：表格样式的 fontRef（主题字体）或直接写的 a:font
    const fontEls = styleFonts(tx.find((k) => k.name === 'a:fontRef' || k.name === 'a:font'));
    const defaults: XEl = { name: 'x', attrs: {}, text: '', children: [{ name: 'a:lvl1pPr', attrs: {}, text: '', children: [{ name: 'a:defRPr', attrs: c.style.bold ? { b: '1' } : {}, text: '', children: [...colorEls, ...fontEls] }] }] };
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
    // 实测（text-default-style、table-default-bold）：表格文字用母版 otherStyle，不用演示文稿默认样式（默认样式写的粗体、斜体
    // 不带到表格里，老 .ppt 转来的课件常见）；文本框、形状反过来只用默认样式
    return renderText(child(c.tc, 'a:txBody'), [ctx.master.txStyles.other, defaults], [bodyPr], box, env, out);
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
  // 实测：跨行合并的单元格文字放不下时，多出的高度全部加到它跨的最后一行（各行自己的文字先撑好）
  for (const c of cells.filter((q) => q.rowSpan > 1).sort((a, b) => a.ri + a.rowSpan - (b.ri + b.rowSpan))) {
    const end = Math.min(nR, c.ri + c.rowSpan);
    let sum = 0;
    for (let r = c.ri; r < end; r++) sum += rowH[r];
    if (c.textH > sum) rowH[end - 1] += c.textH - sum;
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
      // 渐变、图片、图案的坐标以单元格左上角为原点；平铺的图片从表格左上角起铺，对齐方式按单元格的大小算
      // （实测 fills-blip-no-mode：相邻单元格的花纹连续，居中平铺也是）
      const f2 = fill.kind === 'image' && fill.tile ? { ...fill, tile: { ...fill.tile, tx: fill.tile.tx - x, ty: fill.tile.ty - y } } : fill;
      const fa = await fillAttrs(f2, r.doc, w, h, 'norm', r.images, { x: origin.x + x, y: origin.y + y });
      fills.push(`<g transform="translate(${n2(x)} ${n2(y)})"><rect width="${n2(w)}" height="${n2(h)}"${fa}/></g>`);
    }
    // 文字：行高可能被撑高了，按最终高度重排（垂直对齐需要）
    if (c.text) texts.push(await cellText(c, { x, y, w, h }));
    // 边框：单元格自己的 lnL/lnR/lnT/lnB 优先，否则用表格样式
    const side = (own: string, styleSide: Line | undefined) => {
      const ln = child(tcPr, own);
      if (ln) return parseLine([ln], [colors], ctx.part, ctx.pres.displayScale);
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
  // 整表背景（铺在单元格下面）和整表的效果（阴影等）
  const bg = tableBackground(style, colors, ctx);
  const W = colX[nC], H = rowY[nR];
  const bgRect = bg.fill && bg.fill.kind !== 'none'
    ? `<rect width="${n2(W)}" height="${n2(H)}"${await fillAttrs(bg.fill, r.doc, W, H, 'norm', r.images, { x: origin.x, y: origin.y })}/>` : '';
  const body = bgRect + fills.join('') + borders.join('');
  const fx = bg.effect && body ? effectFilter(bg.effect.lst, bg.effect.colors, r.doc, W, H) : undefined;
  return (fx ? `<g filter="url(#${fx})">${body}</g>` : body) + texts.join('');
}
