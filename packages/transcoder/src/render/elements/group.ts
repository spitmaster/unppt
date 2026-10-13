/** 组合（p:grpSp）：子元素坐标系换算、组合填充 */
import type { SlideContext, SlideMapping } from '../../model/model';
import { findFillEl, parseFill, type Fill } from '../../style/fill';
import { n2 } from '../../common/svg';
import { child, numAttr, type XEl } from '../../io/xml';
import { boxTransform, pc, px, readXfrm, withUid, type Box } from '../box';
import type { RenderContext } from '../context';

export async function renderGroup(r: RenderContext, el: XEl, ctx: SlideContext, parentFill?: Fill): Promise<string> {
  const gp = pc(el, 'grpSpPr');
  const xfrm = child(gp, 'a:xfrm');
  const box = readXfrm(xfrm);
  const chOff = child(xfrm, 'a:chOff');
  const chExt = child(xfrm, 'a:chExt');
  const groupFill = parseFill(findFillEl(gp), ctx.colors, ctx.part, parentFill) ?? parentFill;
  const kids = el.children.filter((c) => !c.name.endsWith(':nvGrpSpPr') && !c.name.endsWith(':grpSpPr'));
  const cx = px(numAttr(chOff, 'x')), cy = px(numAttr(chOff, 'y'));
  const cw = px(numAttr(chExt, 'cx')) || box?.w || 0, ch = px(numAttr(chExt, 'cy')) || box?.h || 0;
  const sx = box && cw ? box.w / cw : 1, sy = box && ch ? box.h / ch : 1;
  const inner = await r.shapes(kids, box ? { ...ctx, toSlide: childMapping(ctx.toSlide, box, cx, cy, sx, sy) } : ctx, groupFill);
  if (!inner) return '';
  const uid = r.uidOf(el, ctx);
  if (!box) return withUid(uid, inner, el);
  let t = boxTransform(box);
  if (box.flipH || box.flipV) t += ` translate(${box.flipH ? n2(box.w) : 0} ${box.flipV ? n2(box.h) : 0}) scale(${box.flipH ? -1 : 1} ${box.flipV ? -1 : 1})`;
  t += ` scale(${sx} ${sy}) translate(${n2(-cx)} ${n2(-cy)})`;
  return withUid(uid, `<g transform="${t}">${inner}</g>`, el);
}

/** 组合里子元素坐标到幻灯片像素的换算：只有平移和缩放时能算，转动、翻转时是 null */
function childMapping(outer: SlideMapping | null | undefined, box: Box, cx: number, cy: number, sx: number, sy: number): SlideMapping | null {
  const o = outer === undefined ? { x: 0, y: 0, sx: 1, sy: 1 } : outer;
  if (!o || box.rot || box.flipH || box.flipV) return null;
  return { x: o.x + o.sx * (box.x - cx * sx), y: o.y + o.sy * (box.y - cy * sy), sx: o.sx * sx, sy: o.sy * sy };
}
