/**
 * 线条：合并主题样式和形状自己的 a:ln，生成 stroke 属性和箭头标记。
 */
import { css, type ColorContext, type Rgba } from '../model/color';
import { n2, type SvgDoc } from '../common/svg';
import { attr, child, numAttr, type XEl } from '../io/xml';
import { EMU_PER_PX } from '../model/model';
import { adjustForPathMode, findFillEl, parseFill, type Fill } from './fill';

export interface Line {
  color?: Rgba;
  fill?: Fill;
  width: number;     // 像素
  dash?: string;
  cap: string;
  join: string;
  head?: { type: string; w: string; len: string };
  tail?: { type: string; w: string; len: string };
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
    if (child(ln, 'a:round')) join = 'round';
    else if (child(ln, 'a:bevel')) join = 'bevel';
    else if (child(ln, 'a:miter')) join = 'miter';
    const he = child(ln, 'a:headEnd');
    if (he) head = { type: attr(he, 'type') ?? 'none', w: attr(he, 'w') ?? 'med', len: attr(he, 'len') ?? 'med' };
    const te = child(ln, 'a:tailEnd');
    if (te) tail = { type: attr(te, 'type') ?? 'none', w: attr(te, 'w') ?? 'med', len: attr(te, 'len') ?? 'med' };
  });
  if (!any || !fill || fill.kind === 'none') return undefined;
  const px = Math.max(width / EMU_PER_PX, width > 0 ? 0.5 : 0);
  const color = fill.kind === 'solid' ? fill.color : fill.kind === 'grad' ? fill.stops[0]?.color : undefined;
  return {
    color, fill, width: px,
    dash: dash && dash !== 'solid' && DASH[dash] ? DASH[dash].map((d) => n2(d * px)).join(' ') : undefined,
    cap: cap === 'rnd' ? 'round' : cap === 'sq' ? 'square' : 'butt',
    join, head, tail,
  };
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

export function strokeAttrs(line: Line | undefined, doc: SvgDoc, mode: string): string {
  if (!line) return ' stroke="none"';
  const c = adjustForPathMode(line.color ?? { r: 0, g: 0, b: 0, a: 1 }, mode === 'norm' ? '' : '');
  let s = ` stroke="${css(c)}" stroke-width="${n2(line.width)}"`;
  if (c.a < 0.999) s += ` stroke-opacity="${n2(c.a)}"`;
  if (line.dash) s += ` stroke-dasharray="${line.dash}"`;
  if (line.cap !== 'butt') s += ` stroke-linecap="${line.cap}"`;
  if (line.join !== 'miter') s += ` stroke-linejoin="${line.join}"`;
  if (line.head) { const id = marker(doc, line.head, css(c), true); if (id) s += ` marker-start="url(#${id})"`; }
  if (line.tail) { const id = marker(doc, line.tail, css(c), false); if (id) s += ` marker-end="url(#${id})"`; }
  return s;
}
