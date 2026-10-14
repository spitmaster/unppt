/**
 * 组合缩放时子元素的位置大小（实测）：PowerPoint 缩放组合只改组合自己的大小（ext），子元素的 xfrm、线宽、字号都不变；
 * 显示时子元素的框按比例换算到组合里，线宽和字号保持原样，文字在新的框里重新换行。
 * 所以不能把整组内容用 SVG 的 scale 缩放（线和字会跟着变粗变大），而是把每个子元素的 xfrm 换算到组合的坐标里再画。
 * 转了约 90° 的子元素，它自己的宽对应组合的竖直方向，宽高的缩放比例互换。
 */
import { attr, child, type XEl } from '../io/xml';

export interface ChildMap {
  /** 组合子坐标系的原点（chOff，EMU） */
  ox: number; oy: number;
  /** 子坐标系到组合坐标系的缩放 */
  sx: number; sy: number;
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
  const rot = (((n(x, 'rot') / 60000) % 180) + 180) % 180;
  const swap = rot > 45 && rot < 135;
  const cx = (n(off, 'x') + w / 2 - m.ox) * m.sx, cy = (n(off, 'y') + h / 2 - m.oy) * m.sy;
  const w2 = w * (swap ? m.sy : m.sx), h2 = h * (swap ? m.sx : m.sy);
  const r = (v: number) => String(Math.round(v));
  return {
    ...x,
    children: x.children.map((k) => {
      if (k === off) return { ...k, attrs: { ...k.attrs, x: r(cx - w2 / 2), y: r(cy - h2 / 2) } };
      if (k === ext) return { ...k, attrs: { ...k.attrs, cx: r(w2), cy: r(h2) } };
      return k;
    }),
  };
}
