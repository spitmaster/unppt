/** 一个段落的排版：收集字符、项目符号、制表符、断行、行距和段间距 */
import { EMU_PER_PX } from '../model/model';
import { attr, child, numAttr, type XEl } from '../io/xml';
import { makeBullet, type BulletNumbering } from './bullets';
import { breakLines, trimmedWidth } from './linebreak';
import { layoutTabs, tabStops } from './tabs';
import { makeAtoms, type Measurer } from './measure';
import { kernOn, levelPPr, merge, runStyle } from './style';
import type { Atom, Line, ParagraphLayout, RunStyle, StyleChain, TextEnv } from './types';

/** 排一个文本框里所有段落时共用的东西 */
export interface ParagraphContext {
  fullChain: StyleChain;
  env: TextEnv;
  measurer: Measurer;
  fontScale: number;
  lnReduce: number;
  contentW: number;
  wrap: boolean;
  numbering: BulletNumbering;
}

const effSize = (a: Atom) => (a.style.baseline ? a.style.size * 0.67 : a.style.size);

/** 字距调整跨文字段也要做（实测 PowerPoint：前一段的空格和后一段的 T 照样按字体的成对调整挤近） */
async function kernAcross(prev: Atom | undefined, next: Atom | undefined) {
  if (!prev || !next || !prev.face || prev.face !== next.face || effSize(prev) !== effSize(next)) return;
  if (!kernOn(prev.style) || !kernOn(next.style)) return;
  prev.width += (await prev.face.load()).kern(prev.cp, next.cp) * effSize(prev);
}

export async function layoutParagraph(p: XEl, pi: number, ctx: ParagraphContext): Promise<ParagraphLayout> {
  const { fullChain, env, measurer, fontScale, lnReduce, contentW, wrap } = ctx;
  const pPrEl = child(p, 'a:pPr');
  const lvl = numAttr(pPrEl, 'lvl') ?? 0;
  const levels = levelPPr(fullChain, lvl);
  const pPr = merge([...levels, pPrEl]);
  const defRPr = merge([...levels.map((l) => child(l, 'a:defRPr')), child(pPrEl, 'a:defRPr')]);

  // 收集原子
  const atoms: Atom[] = [];
  let firstStyle: RunStyle | undefined;
  for (const r of p.children) {
    if (r.name === 'a:r' || r.name === 'a:fld') {
      const style = runStyle(merge([defRPr, child(r, 'a:rPr')]), env, fontScale);
      firstStyle ??= style;
      // 页码字段显示当前幻灯片的页码（文件里存的是保存时的页码，母版、版式上的是占位文字 ‹#›）
      const text = r.name === 'a:fld' && attr(r, 'type') === 'slidenum' && env.slideNumber !== undefined ? String(env.slideNumber) : child(r, 'a:t')?.text ?? '';
      const runAtoms = await makeAtoms(text, style, measurer);
      await kernAcross(atoms[atoms.length - 1], runAtoms[0]);
      atoms.push(...runAtoms);
    } else if (r.name === 'a:br') {
      const style = runStyle(merge([defRPr, child(r, 'a:rPr')]), env, fontScale);
      firstStyle ??= style;
      atoms.push({ text: '\n', cp: 10, width: 0, style, family: style.latin, ascent: 0, descent: 0, strikeY: 0, space: false, wide: false, tab: false });
    }
  }
  const endStyle = runStyle(merge([defRPr, child(p, 'a:endParaRPr')]), env, fontScale);
  const baseStyle = firstStyle ?? endStyle;
  const baseM = (await measurer.metrics(baseStyle.latin, baseStyle.bold, baseStyle.italic, true)
    ?? await measurer.metrics(baseStyle.ea, baseStyle.bold, baseStyle.italic, true))?.metrics;
  const emptyAsc = (baseM?.ascent ?? 0.92) * endStyle.size;
  const emptyDesc = (baseM?.descent ?? 0.24) * endStyle.size;

  // 制表符：跳到下一个默认制表位
  const defTab = (numAttr(pPr, 'defTabSz') ?? 914400) / EMU_PER_PX;

  const marL = (numAttr(pPr, 'marL') ?? 0) / EMU_PER_PX;
  const indent = (numAttr(pPr, 'indent') ?? 0) / EMU_PER_PX;
  const algn = attr(pPr, 'algn') ?? 'l';

  // 项目符号
  let bullet: ParagraphLayout['bullet'];
  const bu = ctx.numbering.textFor(pPr, lvl, atoms.length > 0);
  if (bu) bullet = await makeBullet(bu.text, pPr, baseStyle, atoms, fontScale, marL + indent, env, measurer, bu.bu, bu.font);

  let firstX = marL + (indent >= 0 ? indent : 0);
  if (bullet && bullet.x + bullet.width > firstX) firstX = bullet.x + bullet.width + (indent >= 0 ? 0 : 0);
  if (!bullet && indent < 0) firstX = marL + indent;
  const availFirst = contentW - firstX;
  const availRest = contentW - marL;

  // 制表符宽度：自定义制表位，超出后按默认制表位
  layoutTabs(atoms, tabStops(pPr), defTab, firstX);

  const rows = breakLines(atoms, (first) => (first ? availFirst : availRest), wrap, attr(pPr, 'hangingPunct') === '1');
  const lines: Line[] = rows.map((row, i) => {
    const vis = row.filter((a) => a.text !== '\n');
    return {
      atoms: vis,
      width: trimmedWidth(vis),
      size: vis.length ? Math.max(...vis.map((a) => (a.style.baseline ? a.style.size * 0.67 : a.style.size))) : endStyle.size,
      ascent: vis.length ? Math.max(...vis.map((a) => a.ascent)) : emptyAsc,
      descent: vis.length ? Math.max(...vis.map((a) => a.descent)) : emptyDesc,
      x0: i === 0 ? firstX : marL,
      avail: i === 0 ? availFirst : availRest,
    };
  });
  if (!lines.length) lines.push({ atoms: [], width: 0, size: endStyle.size, ascent: emptyAsc, descent: emptyDesc, x0: marL, avail: availRest });

  const spc = (el: XEl | undefined) => {
    const pct = child(el, 'a:spcPct');
    const pts = child(el, 'a:spcPts');
    if (pts) return { pts: (numAttr(pts, 'val') ?? 0) / 100 };
    if (pct) return { pct: (numAttr(pct, 'val') ?? 100000) / 100000 };
    return undefined;
  };
  const ls = spc(pPr.children.find((c) => c.name === 'a:lnSpc')) ?? { pct: 1 };
  if (ls.pct !== undefined) ls.pct = Math.max(0.1, ls.pct - lnReduce);
  const toPx = (s: { pct?: number; pts?: number } | undefined, ref: number) =>
    !s ? 0 : s.pts !== undefined ? s.pts * 96 / 72 : (s.pct ?? 0) * ref;
  const refH = (lines[0].ascent + lines[0].descent) * 1.2;
  return {
    lines,
    // 实测：自动缩小（lnSpcReduction）只减行距，不减段前段后
    spcBef: toPx(spc(pPr.children.find((c) => c.name === 'a:spcBef')), refH),
    spcAft: toPx(spc(pPr.children.find((c) => c.name === 'a:spcAft')), refH),
    lineSpc: ls,
    algn,
    bullet,
    uid: env.uid ? `${env.uid}p${pi}` : undefined,
  };
}
