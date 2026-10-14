/** 把排好的段落放进文本框：垂直对齐、分栏、行高和基线、水平对齐（含两端对齐），输出 SVG */
import { esc, n2 } from '../common/svg';
import type { BodyProps } from './body';
import { reflection } from '../effects/reflection';
import { child } from '../io/xml';
import { decorate } from './decorations';
import { textEl } from './svg-text';
import type { Atom, Line, ParagraphLayout, TextEnv } from './types';

/** 基线对齐整像素的最大字号（像素，20 磅） */
const SNAP_MAX_SIZE = 20 * 96 / 72 + 0.01;

/** 行高大于单倍行框（多倍、固定行距）时，基线离行框上沿的距离占行高的比例（实测，和字体无关） */
const TALL_BASELINE = 0.75;

/** 排好位置的一行：第 pi 段第 li 行，基线、行首横坐标、每个字的横坐标 */
export interface PlacedLine {
  pi: number;
  li: number;
  line: Line;
  baseline: number;
  /** 行框的上边和高度（行距在内） */
  top: number;
  lh: number;
  x: number;
  /** 每个字的起点（两端对齐时已经加上间隙） */
  xs: number[];
  /** 两端对齐时每个间隙多出的宽度 */
  extra: number;
  colX: number;
}

/** 行高、垂直对齐、分栏、基线、水平对齐（含两端对齐）：算出每一行、每个字的位置 */
export function placeLines(
  layouts: ParagraphLayout[], b: BodyProps, outer: { w: number; h: number }, contentW: number, out?: { height: number }, snapY?: (y: number) => number,
): PlacedLine[] {
  const { tIns, bIns, lIns, numCol, spcCol, anchor, wrap, linesLeftToRight } = b;
  // 计算总高度
  const lineHeight = (l: Line, s: ParagraphLayout['lineSpc']) =>
    s.pts !== undefined ? s.pts * 96 / 72 : l.size * 1.2 * (s.pct ?? 1);
  let total = 0;
  layouts.forEach((pl, i) => {
    if (i > 0) total += pl.spcBef;
    for (const l of pl.lines) total += lineHeight(l, pl.lineSpc);
    if (i < layouts.length - 1) total += pl.spcAft;
  });
  if (out) out.height = total + tIns + bIns;
  const availH = outer.h - tIns - bIns;
  let y = tIns + (numCol > 1 ? 0 : anchor === 'ctr' ? (availH - total) / 2 : anchor === 'b' ? availH - total : 0);
  let col = 0;
  const placed: PlacedLine[] = [];
  layouts.forEach((pl, pi) => {
    if (pi > 0) y += pl.spcBef;
    pl.lines.forEach((line, li) => {
      const lh = lineHeight(line, pl.lineSpc);
      // 分栏：这一栏放不下就换到下一栏顶部
      if (numCol > 1 && col < numCol - 1 && y + lh > tIns + availH + 0.5 && y > tIns) { col++; y = tIns; }
      const colX = col * (contentW + spcCol);
      // PowerPoint 单倍行高 = 1.2 × 字号，基线按字体的上下伸比例放在这 1.2 倍的行框里；
      // 行高更大（多倍、固定行距）时基线在行框上沿下方 0.75 × 行高，和字体无关；行高更小时减少的高度全部从文字上方扣
      // （PowerPoint 生成 5 种字体 × 0.9~2.5 倍行距的探针，逐像素读基线，误差 ≤ 0.1 像素）
      const box = line.size * 1.2;
      const natural = line.ascent + line.descent || 1;
      let baseline = lh > box + 0.01 ? y + TALL_BASELINE * lh : y + (lh - box) + box * (line.ascent / natural);
      // 列从左往右排的竖排：把行的位置翻过来（行内基线位置不变）
      if (linesLeftToRight) baseline = outer.h - y - lh + (baseline - y);
      // 横排文字的基线对齐整像素（TextEnv.pixelTop）：只对 20 磅以下的行（更大的字 PowerPoint 纵向按 1/4 像素抗锯齿，实测）
      else if (snapY && line.size <= SNAP_MAX_SIZE) baseline = snapY(baseline);
      let x = lIns + colX + line.x0;
      const free = line.avail - line.width;
      if (pl.algn === 'ctr') x += free / 2;
      else if (pl.algn === 'r') x += free;
      // 两端对齐：多出的宽度分到空格和中文字后面；分散对齐：平均分到每两个字之间（西文单词里的字母之间、空格也算，实测）
      let extra = 0;
      let lastInk = line.atoms.length - 1;
      while (lastInk > 0 && line.atoms[lastInk].space) lastInk--;
      const stretch = (a: Atom, k: number) => (pl.algn === 'dist' ? k < lastInk : k < line.atoms.length - 1 && (a.space || a.wide));
      if (((pl.algn === 'just' && li < pl.lines.length - 1) || pl.algn === 'dist') && wrap && free > 0) {
        const gaps = line.atoms.filter(stretch).length;
        extra = gaps ? free / gaps : 0;
      }
      const xs: number[] = [];
      let cx = x;
      line.atoms.forEach((a, k) => {
        xs.push(cx);
        cx += a.width + (extra && stretch(a, k) ? extra : 0);
      });
      placed.push({ pi, li, line, baseline, top: linesLeftToRight ? outer.h - y - lh : y, lh, x, xs, extra, colX });
      y += lh;
    });
    if (pi < layouts.length - 1) y += pl.spcAft;
  });
  return placed;
}

/** outer 是文字方向上的文本框（竖排时宽高互换）；返回每段一个片段（带段落动画编号） */
export function emitParagraphs(
  layouts: ParagraphLayout[], b: BodyProps, outer: { w: number; h: number }, contentW: number, env: TextEnv, out?: { height: number },
): string[] {
  const { lIns, uprightAll, uprightWide } = b;
  const placed = placeLines(layouts, b, outer, contentW, out, env.snapY);
  const parts: string[] = [];
  let k0 = 0;
  for (let i = 0; i < layouts.length; i++) {
    const pl = layouts[i];
    const pParts: string[] = [];
    // 高亮画在文字下面，下划线和删除线画在文字上面
    const under: string[] = [];
    const over: string[] = [];
    for (; k0 < placed.length && placed[k0].pi === i; k0++) {
      const { line, li, baseline, top, lh, x, xs, extra, colX } = placed[k0];
      const lineStart = pParts.length;
      // 渐变文字按行铺：行的外框（横向从行首到最后一个非空白字的右边）
      const last = line.atoms.reduce((k, a, j) => (a.space || a.tab ? k : j), -1);
      env.lineBox = { x, y: top, w: last >= 0 ? xs[last] + line.atoms[last].width - x : 0, h: lh };
      if (li === 0 && pl.bullet) {
        const b = pl.bullet;
        const bx = pl.algn === 'l' || pl.algn === 'just' ? lIns + colX + b.x : x - b.width;
        const bAlias = b.face && env.embed ? env.embed.alias(b.face) : undefined;
        if (b.image) {
          // 实测：图片底边在基线下约 0.075 倍边长
          pParts.push(`<image data-bu="1" href="${esc(b.image)}" x="${n2(bx)}" y="${n2(baseline - b.width * 0.925)}" width="${n2(b.width)}" height="${n2(b.width)}" preserveAspectRatio="xMidYMid meet"/>`);
        } else pParts.push(textEl(b.text, bx, baseline, b.style, b.family, true, bAlias, env));
      }
      // 按样式、字体分段输出（两端对齐时在每个间隙处分段）
      const atoms = line.atoms;
      let s0 = 0;
      for (let k = 1; k <= atoms.length; k++) {
        const a = atoms[k];
        const p = atoms[k - 1];
        const upright = (q: Atom) => (uprightAll || (uprightWide && q.wide)) && !q.space;
        const boundary = k === atoms.length || a.style !== p.style || a.family !== p.family || a.face !== p.face || (extra > 0 && (pl.algn === 'dist' || p.space || p.wide)) || upright(a) || upright(p);
        if (!boundary) continue;
        const seg = atoms.slice(s0, k);
        const s = seg[0].style;
        const txt = seg.map((q) => (q.tab ? ' ' : q.text)).join('');
        const shift = s.baseline ? -s.baseline / 100 * s.size : 0;
        const st = s.baseline ? { ...s, size: s.size * 0.67 } : s;
        const alias = seg[0].face && env.embed ? env.embed.alias(seg[0].face) : undefined;
        if (seg.length === 1 && upright(seg[0])) {
          // 竖排里正立的字：以字的中心为轴转回来
          const cx = xs[s0] + seg[0].width / 2;
          const cy = baseline - st.size * 0.38;
          pParts.push(`<g transform="rotate(-90 ${n2(cx)} ${n2(cy)})">${textEl(txt, cx, baseline + shift, st, seg[0].family, false, alias, env, 'middle')}</g>`);
        } else if (txt.trim().length || s.underline || s.strike) pParts.push(textEl(txt, perChar(seg) ? xs.slice(s0, k) : xs[s0], baseline + shift, st, seg[0].family, false, alias, env));
        decorate(seg, s, xs[s0], xs[k - 1] + seg[seg.length - 1].width - xs[s0], baseline + shift, st.size, under, over);
        s0 = k;
      }
      // 文字映像：实测紧贴文字底部，以基线为轴翻到下方
      const refl = line.atoms.map((q) => child(q.style.effects, 'a:reflection')).find((r) => r);
      if (refl && env.doc && pParts.length > lineStart) {
        const bottom = baseline, height = line.ascent;
        const content = `<g transform="translate(0 ${n2(height - bottom)})">${pParts.slice(lineStart).join('')}</g>`;
        const mirrored = reflection(refl, height, env.doc, content);
        if (mirrored) under.push(`<g transform="translate(0 ${n2(bottom - height)})">${mirrored}</g>`);
      }
    }
    const all = [...under, ...pParts, ...over];
    if (all.length) parts.push(pl.uid ? `<g data-uid="${pl.uid}">${all.join('')}</g>` : all.join(''));
  }
  env.lineBox = undefined;
  return parts;
}

/**
 * 能不能逐字定位（每个字给一个 x）：一个字一个位置只对不需要字形组合的文字成立——基本平面里、
 * 没有组合符号，也不是阿拉伯、希伯来、印度、东南亚等要连写或重排的文字；多于一个字才有意义
 */
function perChar(seg: Atom[]): boolean {
  if (seg.length < 2) return false;
  return seg.every((a) => {
    if (a.text.length !== 1) return false;
    const c = a.cp;
    return !((c >= 0x0300 && c <= 0x036f) || (c >= 0x0590 && c <= 0x08ff) || (c >= 0x0900 && c <= 0x0dff) || (c >= 0x0e00 && c <= 0x0eff)
      || (c >= 0x1000 && c <= 0x109f) || (c >= 0x1780 && c <= 0x17ff) || (c >= 0x1ab0 && c <= 0x1aff) || (c >= 0x1dc0 && c <= 0x1dff)
      || (c >= 0x200c && c <= 0x200f) || (c >= 0x20d0 && c <= 0x20ff) || (c >= 0xfb1d && c <= 0xfdff) || (c >= 0xfe20 && c <= 0xfe2f) || (c >= 0xfe70 && c <= 0xfeff));
  });
}
