/** 组合（p:grpSp）：子元素坐标系换算（group-map.ts）、组合填充 */
import type { SlideContext, SlideMapping } from '../../model/model';
import { findFillEl, parseFill, type Fill } from '../../style/fill';
import { n2 } from '../../common/svg';
import { child, numAttr, type XEl } from '../../io/xml';
import { boxTransform, pc, px, readXfrm, withUid, type Box } from '../box';
import type { RenderContext } from '../context';
import { mapChild } from '../group-map';

export async function renderGroup(r: RenderContext, el: XEl, ctx: SlideContext, parentFill?: Fill): Promise<string> {
  const gp = pc(el, 'grpSpPr');
  const xfrm = child(gp, 'a:xfrm');
  const box = readXfrm(xfrm);
  const chOff = child(xfrm, 'a:chOff');
  const chExt = child(xfrm, 'a:chExt');
  const groupFill = parseFill(findFillEl(gp), ctx.colors, ctx.part, parentFill) ?? parentFill;
  const kids = el.children.filter((c) => !c.name.endsWith(':nvGrpSpPr') && !c.name.endsWith(':grpSpPr'));
  const uid = r.uidOf(el, ctx);
  if (!box) {
    const inner = await r.shapes(kids, ctx, groupFill);
    return inner ? withUid(uid, inner, el) : '';
  }
  // 子元素的框按比例换算到组合里（线宽、字号不跟着缩放，见 group-map.ts），组合本身只有平移、转动和翻转
  const cw = px(numAttr(chExt, 'cx')) || box.w, ch = px(numAttr(chExt, 'cy')) || box.h;
  const map = { ox: numAttr(chOff, 'x') ?? 0, oy: numAttr(chOff, 'y') ?? 0, sx: cw ? box.w / cw : 1, sy: ch ? box.h / ch : 1 };
  const inner = await r.shapes(kids.map((k) => mapChild(k, map)), { ...ctx, toSlide: childMapping(ctx.toSlide, box) }, groupFill);
  if (!inner) return '';
  let t = boxTransform(box);
  if (box.flipH || box.flipV) t += ` translate(${box.flipH ? n2(box.w) : 0} ${box.flipV ? n2(box.h) : 0}) scale(${box.flipH ? -1 : 1} ${box.flipV ? -1 : 1})`;
  return withUid(uid, `<g transform="${t}">${inner}</g>`, el);
}

/** 组合里子元素坐标（以组合左上角为原点）到幻灯片像素的换算：转动、翻转时是 null */
function childMapping(outer: SlideMapping | null | undefined, box: Box): SlideMapping | null {
  const o = outer === undefined ? { x: 0, y: 0, sx: 1, sy: 1 } : outer;
  if (!o || box.rot || box.flipH || box.flipV) return null;
  return { x: o.x + o.sx * box.x, y: o.y + o.sy * box.y, sx: o.sx, sy: o.sy };
}
