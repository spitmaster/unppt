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
  const k = (await prev.face.load()).kern(prev.cp, next.cp) * effSize(prev);
  // 记在 kern 里：后一个字折到下一行时这一行不算它（见 linebreak.ts）
  if (k) { prev.width += k; prev.kern = (prev.kern ?? 0) + k; }
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
      // 文字里直接写的回车（&#13;，转换、程序生成的课件常见）PowerPoint 按换行画，和换行符一样（实测 text-control-chars）
      const text = (r.name === 'a:fld' && attr(r, 'type') === 'slidenum' && env.slideNumber !== undefined ? String(env.slideNumber) : child(r, 'a:t')?.text ?? '').replace(/\r\n?/g, '\n');
      const runAtoms = await makeAtoms(text, style, measurer);
      await kernAcross(atoms[atoms.length - 1], runAtoms[0]);
      atoms.push(...runAtoms);
    } else if (r.name === 'a:br') {
      const style = runStyle(merge([defRPr, child(r, 'a:rPr')]), env, fontScale);
      firstStyle ??= style;
      // 上伸、下伸只在这个换行单独成一行（空行）时用
      const m = (await measurer.metrics(style.latin, style.bold, style.italic, true) ?? await measurer.metrics(style.ea, style.bold, style.italic, true))?.metrics;
      atoms.push({ text: '\n', cp: 10, width: 0, style, family: style.latin, ascent: (m?.ascent ?? 0.92) * style.size, descent: (m?.descent ?? 0.24) * style.size, strikeY: 0, space: false, wide: false, tab: false });
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

  // 左缩进、首行缩进：首行起点（marL + indent）和悬挂的距离（-indent）各自取整，见 snapIndent
  const marLEmu = numAttr(pPr, 'marL') ?? 0;
  const indentEmu = numAttr(pPr, 'indent') ?? 0;
  const first = snapIndent(marLEmu + indentEmu);
  const marL = indentEmu < 0 ? first + snapIndent(-indentEmu) : snapIndent(marLEmu);
  const indent = first - marL;
  // 右缩进：换行和对齐都在扣掉它的宽度里（实测；PowerPoint 界面里没有，PDF 转换来的课件常见）
  const marR = (numAttr(pPr, 'marR') ?? 0) / EMU_PER_PX;
  const algn = attr(pPr, 'algn') ?? 'l';

  // 项目符号
  let bullet: ParagraphLayout['bullet'];
  const bu = ctx.numbering.textFor(pPr, lvl, atoms.length > 0);
  // 有项目符号、marL + indent < 0：整个第一行右移到项目符号从内边距起（文字在 -indent 处；实测 text-neg-indent）
  const buShift = bu ? Math.max(0, -(marL + indent)) : 0;
  // 项目符号在 marL + min(0, indent)：正的首行缩进时符号仍在 marL，文字在 marL + indent（实测 text-bullet-pos-indent）
  if (bu) bullet = await makeBullet(bu.text, pPr, baseStyle, atoms, fontScale, marL + Math.min(0, indent) + buShift, env, measurer, bu.bu, bu.font);

  let firstX = marL + (indent >= 0 ? indent : 0) + buShift;
  if (bullet && bullet.x + bullet.width > firstX) firstX = bullet.x + bullet.width + (indent >= 0 ? 0 : 0);
  // 负首行缩进：第一行往左伸，但不出文本框的内边距（实测 text-neg-indent：marL 0 + 负 indent 第一行仍从内边距排、能放的字数也一样）
  if (!bullet && indent < 0) firstX = Math.max(0, marL + indent);
  const availFirst = contentW - firstX - marR;
  const availRest = contentW - marL - marR;

  // 制表符宽度：自定义制表位，超出后按默认制表位
  // 悬挂缩进（indent < 0）的左缩进位置本身也是一个制表位：第一行的制表符先跳到那里（样本：没有项目符号、
  // "	+5     墙裂要求" 的 +5 从左缩进 27 磅处排，不是默认制表位 72 磅）
  const stops0 = tabStops(pPr);
  const stops = indent < 0 && marL > firstX ? [...stops0, { pos: marL, algn: 'l' }].sort((a, b) => a.pos - b.pos) : stops0;
  layoutTabs(atoms, stops, defTab, firstX);
  const relayout = atoms.some((a) => a.tab) ? (start: number, first: boolean) => layoutTabs(atoms, stops, defTab, first ? firstX : marL, start) : undefined;

  // 标点溢出边界：哪里都没写时也开着（实测 text-hanging-unset：老 .ppt 转来的课件常不写），只有写了 "0" 才关
  const rows = breakLines(atoms, (first) => (first ? availFirst : availRest), wrap, attr(pPr, 'hangingPunct') !== '0', attr(pPr, 'eaLnBrk') !== '0', attr(pPr, 'latinLnBrk') === '1', relayout);
  const lines: Line[] = rows.map((row, i) => {
    const vis = row.filter((a) => a.text !== '\n');
    // 只有一个换行的空行（两个 a:br 之间没有字）：行高按结束这一行的换行自己的字号（实测 text-br-empty-line）；
    // 有字的行不管行尾换行的字号，段末的空行按段末字号
    const br = vis.length ? undefined : row.find((a) => a.text === '\n');
    // 混排行高只管有段落标记（段末一行）、换行符的行；折行折出来的行，宋体这类字用自己的上伸、下伸（实测 text-mix-wrap-lines：
    // 宋体 + Arial 折成多行，中间的行基线比末行低 1 磅）
    const own = row.length > 0 && row[row.length - 1].text !== '\n' && i < rows.length - 1;
    return {
      atoms: vis,
      width: trimmedWidth(vis),
      size: vis.length ? Math.max(...vis.map((a) => (a.style.baseline ? a.style.size * 0.67 : a.style.size))) : br ? br.style.size : endStyle.size,
      ascent: vis.length ? Math.max(...vis.map((a) => (own ? a.ownAscent ?? a.ascent : a.ascent))) : br ? br.ascent : emptyAsc,
      descent: vis.length ? Math.max(...vis.map((a) => (own ? a.ownDescent ?? a.descent : a.descent))) : br ? br.descent : emptyDesc,
      x0: i === 0 ? firstX : marL,
      avail: i === 0 ? availFirst : availRest,
    };
  });
  if (!lines.length) lines.push({ atoms: [], width: 0, size: endStyle.size, ascent: emptyAsc, descent: emptyDesc, x0: marL, avail: availRest });

  const spc = (el: XEl | undefined) => {
    const pct = child(el, 'a:spcPct');
    const pts = child(el, 'a:spcPts');
    // 固定的行距、段前段后按整磅算（四舍五入：13.5 → 14、21.38 → 21、0.7 → 1、0.49 → 0；实测 text-spcpts-round）
    if (pts) return { pts: Math.round((numAttr(pts, 'val') ?? 0) / 100) };
    if (pct) return { pct: (numAttr(pct, 'val') ?? 100000) / 100000 };
    return undefined;
  };
  const ls = spc(pPr.children.find((c) => c.name === 'a:lnSpc')) ?? { pct: 1 };
  if (ls.pct !== undefined) ls.pct = Math.max(0.1, ls.pct - lnReduce);
  const toPx = (s: { pct?: number; pts?: number } | undefined, ref: number) =>
    !s ? 0 : s.pts !== undefined ? s.pts * 96 / 72 : (s.pct ?? 0) * ref;
  // 段前段后的百分比按单倍行高 1.2 × 字号算，和字体的上下伸无关（实测：雅黑、正黑、宋体、Arial、Calibri、等线、Times 28 磅
  // 段前 20%/50%/100% 都是 6.72/16.8/33.6 磅）
  const refH = lines[0].size * 1.2;
  return {
    lines,
    // 实测：自动缩小（lnSpcReduction）只减行距，不减段前段后
    spcBef: toPx(spc(pPr.children.find((c) => c.name === 'a:spcBef')), refH),
    spcAft: toPx(spc(pPr.children.find((c) => c.name === 'a:spcAft')), refH),
    lineSpc: ls,
    algn,
    fontAlgn: attr(pPr, 'fontAlgn'),
    bullet,
    uid: env.uid ? `${env.uid}p${pi}` : undefined,
  };
}

/**
 * 段落缩进的取整（实测 tools/wraptest：雅黑 10.5 磅 9 个字刚好放得下的框宽）：先四舍五入到 1/20 磅（635 EMU），再向上取整到
 * 排版单位 1/8 磅。左缩进 16.8 / 16.85 / 16.87 磅都按 16.875 排，214313 EMU（16.87504 磅）按 17 磅排，5.06 磅按 5.125 磅排；
 * 悬挂缩进时首行起点和悬挂距离各自取整（marL 214313、indent -214312 的段落正文从 16.875 磅排）。内边距、框宽不取整。返回像素
 */
function snapIndent(emu: number): number {
  const twips = Math.round(emu / 635);
  return Math.ceil((twips * 2) / 5) * 2.5 / 15;
}
