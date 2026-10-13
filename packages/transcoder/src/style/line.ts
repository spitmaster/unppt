/**
 * 线条：合并主题样式和形状自己的 a:ln，生成 stroke 属性和箭头标记。
 */
import { css, type ColorContext, type Rgba } from '../model/color';
import { n2, type SvgDoc } from '../common/svg';
import { attr, child, numAttr, type XEl } from '../io/xml';
import { EMU_PER_PX } from '../model/model';
import { adjustForPathMode, findFillEl, gradientPaint, parseFill, type Fill } from './fill';

export interface Line {
  color?: Rgba;
  fill?: Fill;
  width: number;     // 像素
  dash?: string;
  cap: string;
  join: string;
  head?: { type: string; w: string; len: string };
  tail?: { type: string; w: string; len: string };
  /** 复合线型：dbl 双线、thickThin 外粗内细、thinThick 外细内粗、tri 三线（单线时不写） */
  cmpd?: string;
}

const DASH: Record<string, number[]> = {
  dash: [4, 3], sysDash: [3, 1], dot: [1, 1], sysDot: [1, 1], lgDash: [8, 3], dashDot: [4, 3, 1, 3],
  lgDashDot: [8, 3, 1, 3], lgDashDotDot: [8, 3, 1, 3, 1, 3], sysDashDot: [3, 1, 1, 1], sysDashDotDot: [3, 1, 1, 1, 1, 1],
};

/** 合并线条定义（主题样式 -> 形状自己的 a:ln），返回最终线条；noFill 返回 undefined */
export function parseLine(lns: (XEl | undefined)[], ctxs: ColorContext[], part: string): Line | undefined {
  let width = 9525;
  let fill: Fill | undefined;
  let dash: string | undefined;
  let cap = 'flat', join = 'round';
  let cmpd = 'sng';
  let head, tail;
  let any = false;
  lns.forEach((ln, i) => {
    if (!ln) return;
    any = true;
    const w = numAttr(ln, 'w');
    if (w !== undefined) width = w;
    const f = parseFill(findFillEl(ln), ctxs[i], part);
    if (f) fill = f;
    const pd = attr(child(ln, 'a:prstDash'), 'val');
    if (pd) dash = pd;
    const c = attr(ln, 'cap');
    if (c) cap = c;
    const cm = attr(ln, 'cmpd');
    if (cm) cmpd = cm;
    if (child(ln, 'a:round')) join = 'round';
    else if (child(ln, 'a:bevel')) join = 'bevel';
    else if (child(ln, 'a:miter')) join = 'miter';
    const he = child(ln, 'a:headEnd');
    if (he) head = { type: attr(he, 'type') ?? 'none', w: attr(he, 'w') ?? 'med', len: attr(he, 'len') ?? 'med' };
    const te = child(ln, 'a:tailEnd');
    if (te) tail = { type: attr(te, 'type') ?? 'none', w: attr(te, 'w') ?? 'med', len: attr(te, 'len') ?? 'med' };
  });
  if (!any || !fill || fill.kind === 'none') return undefined;
  // 不到 1 像素的细线（0.25、0.5 磅）PowerPoint 画成 1 像素宽、颜色不变淡（实测）
  const px = Math.max(width / EMU_PER_PX, width > 0 ? 1 : 0);
  const color = fill.kind === 'solid' ? fill.color : fill.kind === 'grad' ? fill.stops[0]?.color : undefined;
  return {
    color, fill, width: px,
    dash: dash && dash !== 'solid' && DASH[dash] ? DASH[dash].map((d) => n2(d * px)).join(' ') : undefined,
    cap: cap === 'rnd' ? 'round' : cap === 'sq' ? 'square' : 'butt',
    join, head, tail,
    ...(cmpd !== 'sng' && ['dbl', 'thickThin', 'thinThick', 'tri'].includes(cmpd) ? { cmpd } : {}),
  };
}

/**
 * 复合线型：用遮罩把整条粗线挖出线间的空隙（实测 PowerPoint 的比例：双线 1:1:1，三线 1:1:2:1:1，
 * 粗细线 3:1:1 且第一个词说的是外侧）。粗细线要分内外：闭合路径按形状内部区域区分，不闭合的按双线画。
 * 返回加在描边元素上的 mask 属性；不是复合线型时返回空串。
 */
export function compoundMask(line: Line, d: string, doc: SvgDoc, box: { w: number; h: number }): string {
  if (!line.cmpd) return '';
  const w = line.width;
  const id = doc.id('cm');
  const m = w * 2;
  const stroke = (width: number, color: string, clip = '') => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${n2(width)}"${clip}/>`;
  const closed = /z\s*$/i.test(d.trim());
  let body = stroke(w, '#fff');
  if (line.cmpd === 'tri') body += stroke(w * 4 / 6, '#000') + stroke(w * 2 / 6, '#fff');
  else if (line.cmpd === 'dbl' || !closed) body += stroke(w / 3, '#000');
  else {
    // 空隙在细线那一侧：外细时空隙在形状外面，外粗时在里面
    const cid = doc.id('cc');
    const outside = line.cmpd === 'thinThick';
    doc.addDef(`<clipPath id="${cid}"><path d="${outside ? `M${n2(-m)} ${n2(-m)}H${n2(box.w + m)}V${n2(box.h + m)}H${n2(-m)}Z` : ''}${d}" clip-rule="evenodd"/></clipPath>`);
    body += stroke(w * 0.6, '#000', ` clip-path="url(#${cid})"`) + stroke(w * 0.2, '#fff');
  }
  doc.addDef(`<mask id="${id}" maskUnits="userSpaceOnUse" x="${n2(-m)}" y="${n2(-m)}" width="${n2(box.w + m * 2)}" height="${n2(box.h + m * 2)}">${body}</mask>`);
  return ` mask="url(#${id})"`;
}

function markerSize(sz: string) {
  return sz === 'sm' ? 2 : sz === 'lg' ? 5 : 3;
}

function marker(doc: SvgDoc, end: { type: string; w: string; len: string }, color: string, isStart: boolean): string | undefined {
  if (end.type === 'none') return undefined;
  const id = doc.id('m');
  const mw = markerSize(end.w), ml = markerSize(end.len);
  let shape: string;
  switch (end.type) {
    case 'oval': shape = `<ellipse cx="${ml / 2}" cy="${mw / 2}" rx="${ml / 2}" ry="${mw / 2}"/>`; break;
    case 'diamond': shape = `<path d="M0 ${mw / 2}L${ml / 2} 0L${ml} ${mw / 2}L${ml / 2} ${mw}Z"/>`; break;
    case 'arrow': shape = `<path d="M0 0L${ml} ${mw / 2}L0 ${mw}" fill="none" stroke="${color}" stroke-width="0.6"/>`; break;
    case 'stealth': shape = `<path d="M0 0L${ml} ${mw / 2}L0 ${mw}L${ml * 0.3} ${mw / 2}Z"/>`; break;
    default: shape = `<path d="M0 0L${ml} ${mw / 2}L0 ${mw}Z"/>`;
  }
  doc.addDef(`<marker id="${id}" viewBox="0 0 ${ml} ${mw}" refX="${ml * 0.8}" refY="${mw / 2}" markerWidth="${ml}" markerHeight="${mw}" orient="${isStart ? 'auto-start-reverse' : 'auto'}" fill="${color}">${shape}</marker>`);
  return id;
}

/** 描边属性；box 是形状尺寸，给了才能画渐变线（不给时用渐变的第一个颜色） */
export function strokeAttrs(line: Line | undefined, doc: SvgDoc, mode: string, box?: { w: number; h: number }): string {
  if (!line) return ' stroke="none"';
  const c = adjustForPathMode(line.color ?? { r: 0, g: 0, b: 0, a: 1 }, mode === 'norm' ? '' : '');
  const grad = box && line.fill?.kind === 'grad' ? line.fill : undefined;
  let s = ` stroke="${grad ? gradientPaint(grad, doc, box!.w, box!.h, 'norm') : css(c)}" stroke-width="${n2(line.width)}"`;
  if (!grad && c.a < 0.999) s += ` stroke-opacity="${n2(c.a)}"`;
  if (line.dash) s += ` stroke-dasharray="${line.dash}"`;
  if (line.cap !== 'butt') s += ` stroke-linecap="${line.cap}"`;
  if (line.join !== 'miter') s += ` stroke-linejoin="${line.join}"`;
  if (line.head) { const id = marker(doc, line.head, css(c), true); if (id) s += ` marker-start="url(#${id})"`; }
  if (line.tail) { const id = marker(doc, line.tail, css(c), false); if (id) s += ` marker-end="url(#${id})"`; }
  return s;
}
