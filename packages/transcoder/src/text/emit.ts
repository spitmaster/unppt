/** 把排好的段落放进文本框：垂直对齐、分栏、行高和基线、水平对齐（含两端对齐），输出 SVG */
import { esc, n2 } from '../common/svg';
import type { BodyProps } from './body';
import { reflection } from '../effects/reflection';
import { child, type XEl } from '../io/xml';
import { decorate } from './decorations';
import { textEl } from './svg-text';
import { hangable } from './linebreak';
import type { Atom, Line, ParagraphLayout, TextEnv } from './types';

/** 竖排正立的字往基线方向挪的距离（× 字号，实测 text-vert-insets） */
const UPRIGHT_DROP = 0.14;

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
  layouts: ParagraphLayout[], b: BodyProps, outer: { w: number; h: number }, contentW: number, out?: { height: number }, snapY?: (y: number) => number, pixelScale = 1,
): PlacedLine[] {
  const { tIns, bIns, lIns, numCol, spcCol, anchor, wrap, linesLeftToRight } = b;
  // 水平居中（anchorCtr）：按全宽折好的行，整块（最宽一行的外接框）在框里水平居中，各段自己的对齐在这个块里（诊断样本：左对齐的三段文字
  // 整体右移 (内宽 − 最宽行) / 2）
  // 两端 / 分散对齐的非末行会拉满可用宽度，按拉满后的宽度算
  const stretched = (pl: ParagraphLayout, li: number) => (pl.algn === 'just' && li < pl.lines.length - 1) || pl.algn === 'dist';
  const blockW = b.anchorCtr && numCol === 1 ? Math.max(0, ...layouts.flatMap((pl) => pl.lines.map((l, li) => l.x0 + (stretched(pl, li) ? l.avail : l.width)))) : 0;
  const blockShift = blockW ? Math.max(0, (contentW - blockW) / 2) : 0;
  // 计算总高度
  const lineHeight = (l: Line, s: ParagraphLayout['lineSpc']) =>
    s.pts !== undefined ? s.pts * 96 / 72 : l.size * 1.2 * (s.pct ?? 1);
  let total = 0;
  layouts.forEach((pl, i) => {
    if (i > 0) total += pl.spcBef;
    for (const l of pl.lines) total += lineHeight(l, pl.lineSpc);
    if (i < layouts.length - 1) total += pl.spcAft;
  });
  // 实测（COM 量顶端 / 居中对齐的行位置；表格行高）：文字块的高度里，多倍行距的最后一行只算到基线加单倍行框里的下伸，
  // 下面多出的空白不计入——居中、底端对齐和撑高表格行都按这个高度（1.5 倍、2 倍行距都吻合到 0.01 磅）。
  // 段落的字体对齐（fontAlgn）是 ctr、t 时按完整行高（实测表格行高）
  const lastP = layouts[layouts.length - 1], last = lastP?.lines[lastP.lines.length - 1];
  const lastLh = last ? lineHeight(last, lastP.lineSpc) : 0, lastBox = last ? last.size * 1.2 : 0;
  const full = lastP?.fontAlgn === 'ctr' || lastP?.fontAlgn === 't';
  // fontAlgn="b" 的按比例加大的行基线上移了半个下伸，块的底也跟着上移（table-fontalgn-tall：150% 行距的表格行比 PowerPoint 高半个下伸；
  // 固定行距的不减，样本：9 磅字 18 磅固定行距的表格行高按不减的对）
  const trim = last && !full && lastLh > lastBox + 0.01 ? lastLh * (1 - TALL_BASELINE) - lastBox * last.descent / (last.ascent + last.descent || 1)
    + (lastP.fontAlgn === 'b' && lastP.lineSpc.pts === undefined ? last.descent / 2 : 0) : 0;
  const availH = outer.h - tIns - bIns, shown = total - Math.max(0, trim);
  if (out) out.height = shown + tIns + bIns;
  let y = tIns + (numCol > 1 ? 0 : anchor === 'ctr' ? (availH - shown) / 2 : anchor === 'b' ? availH - shown : 0);
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
      // 字体对齐（fontAlgn）：行高不小于单倍时，ctr 把字的上伸 + 下伸框居中放进行底那个单倍行框，t 让它的顶对齐单倍行框的顶，
      // b 在加大的行里比自动再上移半个下伸（实测 text-fontalgn：8 种字体 × 80/100/150% 行距逐行量墨迹，单倍和加大的行误差 ≤ 0.25 磅；
      // 行高小于单倍的没管）
      if (lh >= box - 0.01) {
        if (pl.fontAlgn === 'ctr') baseline = y + lh - box / 2 + (line.ascent - line.descent) / 2;
        else if (pl.fontAlgn === 't') baseline = y + lh - box + line.ascent;
        else if (pl.fontAlgn === 'b' && lh > box + 0.01) baseline -= line.descent / 2;
      }
      // 列从左往右排的竖排：把行的位置翻过来（行内基线位置不变）
      if (linesLeftToRight) baseline = outer.h - y - lh + (baseline - y);
      // 横排文字的基线对齐整像素（TextEnv.pixelTop）：只对 20 磅以下的行（更大的字 PowerPoint 纵向按 1/4 像素抗锯齿，实测）
      else if (snapY && line.size * pixelScale <= SNAP_MAX_SIZE) baseline = snapY(baseline);
      let x = lIns + colX + line.x0 + blockShift;
      const free = line.avail - line.width;
      const alignFree = (blockW ? blockW - line.x0 : line.avail) - line.width;
      if (pl.algn === 'ctr') x += alignFree / 2;
      else if (pl.algn === 'r') x += alignFree;
      // 分散对齐：多出的宽度平均分到每两个字之间（西文单词里的字母之间、空格也算，实测）。两端对齐见 justAdds
      let lastInk = line.atoms.length - 1;
      while (lastInk > 0 && line.atoms[lastInk].space) lastInk--;
      // 行尾标点悬挂在框外的行：除去这个标点按放满算，段末行也拉开（实测：两端对齐的段末行 10 字 + 悬挂的句号，10 个字拉开到框宽）
      const hung = pl.algn === 'just' && free < -0.01 && lastInk === line.atoms.length - 1 && hangable(line.atoms[lastInk].text);
      const room = hung ? free + line.atoms[lastInk].width : free;
      let adds: number[] | undefined;
      if (pl.algn === 'dist' && wrap && room > 0 && lastInk > 0) adds = line.atoms.map((_a, k) => (k < lastInk ? room / lastInk : 0));
      else if (pl.algn === 'just' && (li < pl.lines.length - 1 || hung) && wrap && room > 0) adds = justAdds(line.atoms, lastInk, room);
      const extra = adds?.some((v) => v > 0) ? 1 : 0;
      const xs: number[] = [];
      let cx = x;
      line.atoms.forEach((a, k) => {
        xs.push(cx);
        cx += a.width + (adds?.[k] ?? 0);
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
  const placed = placeLines(layouts, b, outer, contentW, out, env.snapY, env.pixelScale);
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
        const sized = s.baseline ? { ...s, size: s.size * 0.67 } : s;
        // 实测（text-bold-light）：字体没有粗体字形时 PowerPoint 在原字形上人工加粗、字宽不变。照常写 bold 的话，
        // 细体（微软雅黑 Light、等线 Light 等）会被浏览器换成同族的真粗体，黑体等由浏览器合成的粗体也比 PowerPoint 粗将近一倍
        const thin = s.bold && seg[0].face && !seg[0].face.bold;
        const st = thin ? { ...sized, bold: false, fakeBold: true } : sized;
        const alias = seg[0].face && env.embed ? env.embed.alias(seg[0].face) : undefined;
        if (seg.length === 1 && upright(seg[0])) {
          // 竖排里正立的字：以字的中心为轴转回来；整个字再往基线那边挪 0.14 个字号（实测 text-vert-insets：eaVert、mongolianVert 的
          // 雅黑 28 磅正立汉字比按字身居中的位置靠屏幕左边 5 像素，整体转的 vert 不差）
          const cx = xs[s0] + seg[0].width / 2;
          const up = UPRIGHT_DROP * st.size;
          const cy = baseline - st.size * 0.38 + up;
          pParts.push(`<g transform="rotate(-90 ${n2(cx)} ${n2(cy)})">${textEl(txt, cx, baseline + shift + up, st, seg[0].family, false, alias, env, 'middle')}</g>`);
        } else if (txt.trim().length || s.underline || s.strike) pParts.push(textEl(txt, perChar(seg) ? xs.slice(s0, k) : xs[s0], baseline + shift, st, seg[0].family, false, alias, env));
        decorate(seg, s, xs[s0], xs[k - 1] + seg[seg.length - 1].width - xs[s0], baseline + shift, st.size, under, over);
        s0 = k;
      }
      // 文字映像：实测紧贴文字底部，以基线为轴翻到下方
      const refl = line.atoms.map((q) => child(q.style.effects, 'a:reflection')).find((r) => r);
      if (refl && env.doc && pParts.length > lineStart) {
        const bottom = baseline, height = line.ascent;
        const content = `<g transform="translate(0 ${n2(height - bottom)})">${pParts.slice(lineStart).join('')}</g>`;
        const mirrored = reflection(scaleReflection(refl, line.size), height, env.doc, content);
        if (mirrored) under.push(`<g transform="translate(0 ${n2(bottom - height)})">${mirrored}</g>`);
      }
    }
    const all = [...under, ...groupFilters(pParts), ...over];
    if (all.length) parts.push(pl.uid ? `<g data-uid="${pl.uid}">${all.join('')}</g>` : all.join(''));
  }
  env.lineBox = undefined;
  return parts;
}

/**
 * 文字映像离基线的距离随字号线性变化：距离 × 字号 / REFL_PT（size 是像素）。实测（text-reflection-dist、text-glow-scale：
 * Arial 16~128 磅、距离 0/5/10/20 磅）：距离 0 时映像紧贴基线；5 磅在 16/32/64 磅的字上是 6/14/25 像素，20 磅在 16/64 磅上
 * 24/96 像素，吻合到 1~2 像素
 */
function scaleReflection(refl: XEl, size: number): XEl {
  const d = Number(refl.attrs.dist ?? 0);
  return d ? { ...refl, attrs: { ...refl.attrs, dist: String(Math.round((d * size * 0.75) / REFL_PT)) } } : refl;
}

const REFL_PT = 17.5;

/**
 * 两端对齐时每个字后面加多少（实测 text-just-spaces：COM 读字的位置）：只有最后一个字之前的位置参与，行首空格不算；
 * 空格优先，先各补到半个字号宽；剩下的平均分给空格和中日韩字后面——只有 lang（不看 altLang）是中日韩的字才算，
 * lang 写 en-US 的中文段落只拉开空格，没有空格就不拉开
 */
function justAdds(atoms: Atom[], lastInk: number, room: number): number[] {
  const adds = atoms.map(() => 0);
  let lead = 0;
  while (lead < lastInk && atoms[lead].space) lead++;
  const sp: number[] = [], ea: number[] = [];
  for (let k = lead; k < lastInk; k++) {
    if (atoms[k].space) sp.push(k);
    else if (atoms[k].wide && atoms[k].style.eaLang) ea.push(k);
  }
  if (!ea.length) {
    for (const k of sp) adds[k] = room / sp.length;
    return adds;
  }
  let left = room;
  if (sp.length) {
    const share = room / sp.length;
    for (const k of sp) {
      const give = Math.min(share, Math.max(0, atoms[k].style.size / 2 - atoms[k].width));
      adds[k] = give;
      left -= give;
    }
  }
  if (left > 1e-6) {
    const per = left / (sp.length + ea.length);
    for (const k of [...sp, ...ea]) adds[k] += per;
  }
  return adds;
}

/**
 * 相邻、用同一个文字效果滤镜（阴影、发光、棱台……）的 <text> 收进一组，滤镜放在组上，和整段没拆开的文字一样（一段 <text> 的
 * 阴影整体在文字下面）。两端对齐、分散对齐时中文每个字单独一段，每个字各做一遍滤镜，滤镜范围又是整个文本框：
 * 样本里一页 132 个带阴影的字，整页图要画 30 秒
 */
export function groupFilters(parts: string[]): string[] {
  const out: string[] = [];
  let run: string[] = [];
  let id = '';
  const flush = () => {
    if (run.length > 1) out.push(`<g filter="url(#${id})">${run.map((t) => t.replace(FILTERED, '$1$3')).join('')}</g>`);
    else out.push(...run);
    run = [];
  };
  for (const part of parts) {
    const fid = FILTERED.exec(part)?.[2];
    if (!fid || fid !== id) flush();
    if (fid) { run.push(part); id = fid; } else { out.push(part); id = ''; }
  }
  flush();
  return out;
}

/** textEl 输出的带滤镜的 <text>：滤镜是开始标签里最后一个属性 */
const FILTERED = /^(<text [^>]*?) filter="url\(#([^)"]+)\)"( xml:space="preserve">)/;

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
