/** 组合（p:grpSp）：子元素坐标系换算（group-map.ts）、组合填充 */
import { EMU_PER_PX, type SlideContext, type SlideMapping } from '../../model/model';
import { findFillEl, parseFill, type Fill } from '../../style/fill';
import { child, numAttr, type XEl } from '../../io/xml';
import { boxTransform, pc, px, readXfrm, withUid, type Box } from '../box';
import type { RenderContext } from '../context';
import { mapChild } from '../group-map';
import { effectFilter } from '../../effects/effect-filter';

export async function renderGroup(r: RenderContext, el: XEl, ctx: SlideContext, parentFill?: Fill): Promise<string> {
  const gp = pc(el, 'grpSpPr');
  const xfrm = child(gp, 'a:xfrm');
  const box = readXfrm(xfrm);
  const chOff = child(xfrm, 'a:chOff');
  const chExt = child(xfrm, 'a:chExt');
  const own = parseFill(findFillEl(gp), ctx.colors, ctx.part, parentFill);
  let groupFill = own ?? parentFill;
  const kids = el.children.filter((c) => !c.name.endsWith(':nvGrpSpPr') && !c.name.endsWith(':grpSpPr'));
  const uid = r.uidOf(el, ctx);
  if (!box) {
    const inner = await r.shapes(kids, ctx, groupFill);
    return inner ? withUid(uid, inner, el) : '';
  }
  // 子元素的框按比例换算到组合里、翻转下放到子元素（线宽、字号不跟着缩放，文字不镜像，见 group-map.ts）
  // 组合填充的图片、渐变铺满组合的外框（子元素坐标以组合左上角为原点）；从外层组合继承来的，范围换到这一层的坐标
  if (groupFill?.kind === 'image' || groupFill?.kind === 'grad') {
    const a = groupFill.area;
    groupFill = own && own !== parentFill
      ? { ...groupFill, area: { x: 0, y: 0, w: box.w, h: box.h, flipH: box.flipH, flipV: box.flipV } }
      : a ? { ...groupFill, area: { ...a, x: a.x - box.x, y: a.y - box.y } } : groupFill;
  }
  const cw = px(numAttr(chExt, 'cx')) || box.w, ch = px(numAttr(chExt, 'cy')) || box.h;
  const map = {
    ox: numAttr(chOff, 'x') ?? 0, oy: numAttr(chOff, 'y') ?? 0, sx: cw ? box.w / cw : 1, sy: ch ? box.h / ch : 1,
    w: box.w * EMU_PER_PX, h: box.h * EMU_PER_PX, flipH: box.flipH, flipV: box.flipV,
  };
  const inner = await r.shapes(kids.map((k) => mapChild(k, map)), { ...ctx, toSlide: childMapping(ctx.toSlide, box) }, groupFill);
  if (!inner) return '';
  // 组合自己的效果（阴影、发光等）：按合起来的整体做，子元素之间不互相投影（样本；实测 group-effects）
  const filter = effectFilter(child(gp, 'a:effectLst'), ctx.colors, r.doc, box.w, box.h);
  const body = filter ? `<g filter="url(#${filter})">${inner}</g>` : inner;
  // 翻转已经下放到子元素（group-map.ts），这里只有平移和转动
  return withUid(uid, `<g transform="${boxTransform(box)}">${body}</g>`, el);
}

/** 组合里子元素坐标（以组合左上角为原点）到幻灯片像素的换算：组合转动时是 null（翻转已经下放到子元素） */
function childMapping(outer: SlideMapping | null | undefined, box: Box): SlideMapping | null {
  const o = outer === undefined ? { x: 0, y: 0, sx: 1, sy: 1 } : outer;
  if (!o || box.rot) return null;
  return { x: o.x + o.sx * box.x, y: o.y + o.sy * box.y, sx: o.sx, sy: o.sy };
}
