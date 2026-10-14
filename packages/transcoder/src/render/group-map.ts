/**
 * 组合里子元素的位置大小（实测）：
 *   - 缩放：PowerPoint 缩放组合只改组合自己的大小（ext），子元素的 xfrm、线宽、字号都不变；显示时子元素的框按比例换算到组合里，
 *     线宽和字号保持原样，文字在新的框里重新换行。所以不能把整组内容用 SVG 的 scale 缩放（线和字会跟着变粗变大）；
 *     转了约 90° 的子元素，它自己的宽对应组合的竖直方向，宽高的缩放比例互换。
 *   - 翻转：组合的翻转下放到每个子元素——位置镜像、子元素自己的 flipH/flipV 切换、转角取反；子元素再按自己的翻转画
 *     （水平翻转的形状文字不镜像，垂直翻转的文字转 180°），所以不能把整组内容镜像（文字会反过来）。
 * 换算后子元素以组合左上角为原点，组合本身只剩平移和转动。
 */
import { attr, child, type XEl } from '../io/xml';

export interface ChildMap {
  /** 组合子坐标系的原点（chOff，EMU） */
  ox: number; oy: number;
  /** 子坐标系到组合坐标系的缩放 */
  sx: number; sy: number;
  /** 组合的大小（EMU）和翻转 */
  w: number; h: number;
  flipH: boolean; flipV: boolean;
}

/** 子元素换算到组合坐标（以组合左上角为原点）后的副本；没有 xfrm 的原样返回 */
export function mapChild(el: XEl, m: ChildMap): XEl {
  if (el.name === 'mc:AlternateContent') return { ...el, children: el.children.map((c) => ({ ...c, children: c.children.map((k) => mapChild(k, m)) })) };
  const holder = el.children.find((c) => /:(spPr|grpSpPr)$/.test(c.name));
  if (holder) {
    const x = child(holder, 'a:xfrm');
    return x ? { ...el, children: el.children.map((c) => (c === holder ? { ...c, children: c.children.map((k) => (k === x ? mapXfrm(k, m) : k)) } : c)) } : el;
  }
  const fx = el.children.find((c) => /:xfrm$/.test(c.name));
  return fx ? { ...el, children: el.children.map((c) => (c === fx ? mapXfrm(c, m) : c)) } : el;
}

function mapXfrm(x: XEl, m: ChildMap): XEl {
  const off = child(x, 'a:off'), ext = child(x, 'a:ext');
  if (!off || !ext) return x;
  const n = (e: XEl, k: string) => Number(attr(e, k) ?? 0);
  const w = n(ext, 'cx'), h = n(ext, 'cy');
  const rot0 = n(x, 'rot');
  const rot = (((rot0 / 60000) % 180) + 180) % 180;
  const swap = rot > 45 && rot < 135;
  let cx = (n(off, 'x') + w / 2 - m.ox) * m.sx, cy = (n(off, 'y') + h / 2 - m.oy) * m.sy;
  if (m.flipH) cx = m.w - cx;
  if (m.flipV) cy = m.h - cy;
  const w2 = w * (swap ? m.sy : m.sx), h2 = h * (swap ? m.sx : m.sy);
  const r = (v: number) => String(Math.round(v));
  const attrs: Record<string, string> = { ...x.attrs };
  // 镜像一次，转角取反（两个方向都镜像相当于转 180°，转角不变）
  if (m.flipH !== m.flipV && rot0) attrs.rot = r(((21600000 - rot0) % 21600000 + 21600000) % 21600000);
  const toggle = (k: string, on: boolean) => { if (!on) return; if (attrs[k] === '1') delete attrs[k]; else attrs[k] = '1'; };
  toggle('flipH', m.flipH);
  toggle('flipV', m.flipV);
  return {
    ...x,
    attrs,
    children: x.children.map((k) => {
      if (k === off) return { ...k, attrs: { ...k.attrs, x: r(cx - w2 / 2), y: r(cy - h2 / 2) } };
      if (k === ext) return { ...k, attrs: { ...k.attrs, cx: r(w2), cy: r(h2) } };
      return k;
    }),
  };
}
