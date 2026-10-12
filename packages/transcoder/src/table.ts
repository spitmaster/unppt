/**
 * 表格：列宽来自 a:tblGrid，行高取"设定行高"和"文字实际高度"的较大值；
 * 表格样式（ppt/tableStyles.xml）按 整表 -> 条纹 -> 首尾列 -> 首尾行 的顺序叠加，单元格自己的设置最后覆盖。
 */
import { colorIn, type ColorContext } from './color';
import { fillAttrs, findFillEl, parseFill, parseLine, strokeAttrs, type Fill, type Line } from './fill';
import { EMU_PER_PX, type SlideContext } from './model';
import { n2 } from './svg';
import { renderText, type TextEnv } from './text';
import { attr, child, children, numAttr, type XEl } from './xml';
import type { SlideRenderer } from './render';

const px = (v: number | undefined) => (v ?? 0) / EMU_PER_PX;

interface CellStyle { fill?: Fill; borders: Record<string, Line | undefined>; bold?: boolean; color?: XEl; }

async function tableStyles(r: SlideRenderer): Promise<XEl | undefined> {
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
  for (const side of ['left', 'right', 'top', 'bottom', 'insideH', 'insideV']) {
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
  Object.assign(into.borders, Object.fromEntries(Object.entries(s.borders).filter(([, v]) => v !== undefined || true)));
  if (s.bold !== undefined) into.bold = s.bold;
  if (s.color) into.color = s.color;
}

export async function renderTable(tbl: XEl | undefined, _w: number, _h: number, r: SlideRenderer, ctx: SlideContext): Promise<string> {
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

  // 每个单元格的样式
  const cellStyle = (ri: number, ci: number): CellStyle => {
    const s: CellStyle = { borders: {} };
    const get = (name: string) => partStyle(child(style, `a:${name}`), colors, ctx, ctx.theme);
    mergeStyle(s, get('wholeTbl'));
    if (flags.bandRow) {
      const idx = ri - (flags.firstRow ? 1 : 0);
      if (idx >= 0) mergeStyle(s, get(idx % 2 === 0 ? 'band1H' : 'band2H'));
    }
    if (flags.bandCol) {
      const idx = ci - (flags.firstCol ? 1 : 0);
      if (idx >= 0) mergeStyle(s, get(idx % 2 === 0 ? 'band1V' : 'band2V'));
    }
    if (flags.firstCol && ci === 0) mergeStyle(s, get('firstCol'));
    if (flags.lastCol && ci === nC - 1) mergeStyle(s, get('lastCol'));
    if (flags.firstRow && ri === 0) mergeStyle(s, get('firstRow'));
    if (flags.lastRow && ri === nR - 1) mergeStyle(s, get('lastRow'));
    return s;
  };

  // 第一遍：排文字，算行高
  interface Cell { ri: number; ci: number; span: number; rowSpan: number; tc: XEl; style: CellStyle; text?: string; textH: number; }
  const cells: Cell[] = [];
  const rowH = rows.map((tr) => px(numAttr(tr, 'h')));
  for (let ri = 0; ri < nR; ri++) {
    const tcs = children(rows[ri], 'a:tc');
    for (let ci = 0; ci < tcs.length && ci < nC; ci++) {
      const tc = tcs[ci];
      if (attr(tc, 'hMerge') === '1' || attr(tc, 'vMerge') === '1') continue;
      const span = numAttr(tc, 'gridSpan') ?? 1;
      const rowSpan = numAttr(tc, 'rowSpan') ?? 1;
      const style = cellStyle(ri, ci);
      const cell: Cell = { ri, ci, span, rowSpan, tc, style, textH: 0 };
      cells.push(cell);
      const tcPr = child(tc, 'a:tcPr');
      const w = colX[Math.min(nC, ci + span)] - colX[ci];
      const out = { height: 0 };
      const rPrDefaults: XEl = { name: 'a:lvl1pPr', attrs: {}, text: '', children: [{ name: 'a:defRPr', attrs: style.bold ? { b: '1' } : {}, text: '', children: style.color ? style.color.children.filter((c) => c.name.endsWith('Clr') || c.name === 'a:fontRef').map((c) => c.name === 'a:fontRef' ? { name: 'a:solidFill', attrs: {}, text: '', children: c.children } : { name: 'a:solidFill', attrs: {}, text: '', children: [c] }) : [] }] };
      const env: TextEnv = { colors, theme: ctx.theme, fonts: r.env.fonts, missingFonts: r.env.missingFonts };
      const bodyPr: XEl = {
        name: 'a:bodyPr', text: '', children: [],
        attrs: {
          lIns: attr(tcPr, 'marL') ?? '91440', rIns: attr(tcPr, 'marR') ?? '91440',
          tIns: attr(tcPr, 'marT') ?? '45720', bIns: attr(tcPr, 'marB') ?? '45720',
          anchor: attr(tcPr, 'anchor') ?? 't',
        },
      };
      cell.text = await renderText(child(tc, 'a:txBody'), [r.env.pres.defaultTextStyle, { name: 'x', attrs: {}, text: '', children: [rPrDefaults] }], [bodyPr], { x: 0, y: 0, w, h: rowH[ri] }, env, out);
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
    if (fill && fill.kind !== 'none') fills.push(`<rect x="${n2(x)}" y="${n2(y)}" width="${n2(w)}" height="${n2(h)}"${await fillAttrs(fill, r.doc, w, h, 'norm', r.images)}/>`);
    if (c.text) {
      // 重新排版到最终高度（垂直对齐需要）
      const out = { height: 0 };
      const env: TextEnv = { colors, theme: ctx.theme, fonts: r.env.fonts, missingFonts: r.env.missingFonts };
      const rPrDefaults: XEl = { name: 'a:lvl1pPr', attrs: {}, text: '', children: [{ name: 'a:defRPr', attrs: c.style.bold ? { b: '1' } : {}, text: '', children: c.style.color ? c.style.color.children.filter((k) => k.name.endsWith('Clr') || k.name === 'a:fontRef').map((k) => k.name === 'a:fontRef' ? { name: 'a:solidFill', attrs: {}, text: '', children: k.children } : { name: 'a:solidFill', attrs: {}, text: '', children: [k] }) : [] }] };
      const bodyPr: XEl = {
        name: 'a:bodyPr', text: '', children: [],
        attrs: {
          lIns: attr(tcPr, 'marL') ?? '91440', rIns: attr(tcPr, 'marR') ?? '91440',
          tIns: attr(tcPr, 'marT') ?? '45720', bIns: attr(tcPr, 'marB') ?? '45720',
          anchor: attr(tcPr, 'anchor') ?? 't',
        },
      };
      texts.push(await renderText(child(c.tc, 'a:txBody'), [r.env.pres.defaultTextStyle, { name: 'x', attrs: {}, text: '', children: [rPrDefaults] }], [bodyPr], { x, y, w, h }, env, out));
    }
    // 边框：单元格自己的 lnL/lnR/lnT/lnB 优先，否则用表格样式
    const side = (own: string, styleSide: Line | undefined) => {
      const ln = child(tcPr, own);
      if (ln) return parseLine([ln], [colors], ctx.part);
      return styleSide;
    };
    const sb = c.style.borders;
    const left = side('a:lnL', c.ci === 0 ? sb.left : sb.insideV ?? sb.left);
    const right = side('a:lnR', c.ci + c.span >= nC ? sb.right : sb.insideV ?? sb.right);
    const top = side('a:lnT', c.ri === 0 ? sb.top : sb.insideH ?? sb.top);
    const bottom = side('a:lnB', c.ri + c.rowSpan >= nR ? sb.bottom : sb.insideH ?? sb.bottom);
    const seg = (l: Line | undefined, x1: number, y1: number, x2: number, y2: number) => {
      if (l) borders.push(`<line x1="${n2(x1)}" y1="${n2(y1)}" x2="${n2(x2)}" y2="${n2(y2)}"${strokeAttrs({ ...l, head: undefined, tail: undefined }, r.doc, 'norm')}/>`);
    };
    seg(top, x, y, x + w, y);
    seg(bottom, x, y + h, x + w, y + h);
    seg(left, x, y, x, y + h);
    seg(right, x + w, y, x + w, y + h);
  }
  return fills.join('') + borders.join('') + texts.join('');
}
