/** 元素的位置框（a:xfrm）和输出时用的变换 */
import { esc, n2 } from '../common/svg';
import { attr, boolAttr, child, numAttr, type XEl } from '../io/xml';
import { EMU_PER_PX } from '../model/model';
import type { SvgDoc } from '../common/svg';
import { perspectiveMesh } from '../style/perspective';

export interface Box { x: number; y: number; w: number; h: number; rot: number; flipH: boolean; flipV: boolean; }

export const px = (emu: number | undefined) => (emu ?? 0) / EMU_PER_PX;

/** 兼容 p: 和 dsp:（SmartArt 绘图）两种前缀的子元素查找 */
export function pc(el: XEl | undefined, local: string): XEl | undefined {
  return child(el, `p:${local}`) ?? child(el, `dsp:${local}`);
}

export function readXfrm(xfrm: XEl | undefined): Box | undefined {
  if (!xfrm) return undefined;
  const off = child(xfrm, 'a:off');
  const ext = child(xfrm, 'a:ext');
  if (!off && !ext) return undefined;
  return {
    x: px(numAttr(off, 'x')), y: px(numAttr(off, 'y')), w: px(numAttr(ext, 'cx')), h: px(numAttr(ext, 'cy')),
    rot: (numAttr(xfrm, 'rot') ?? 0) / 60000,
    flipH: boolAttr(xfrm, 'flipH') ?? false, flipV: boolAttr(xfrm, 'flipV') ?? false,
  };
}

export function nvProps(el: XEl): XEl | undefined {
  const nv = el.children.find((c) => c.name.endsWith(':nvSpPr') || c.name.endsWith(':nvPicPr') || c.name.endsWith(':nvGrpSpPr') || c.name.endsWith(':nvCxnSpPr') || c.name.endsWith(':nvGraphicFramePr'));
  return nv?.children.find((c) => c.name.endsWith(':cNvPr'));
}

/**
 * 动画目标外包一层不带 transform 的 g，播放器用 CSS 动画时不会覆盖元素自己的位置变换。
 * el 是元素本身：带上它的名字（data-name），平滑切换按名字配对前后两页的对象。
 */
export function withUid(uid: string | undefined, inner: string, el: XEl): string {
  if (!uid) return inner;
  const name = attr(nvProps(el), 'name');
  return `<g data-uid="${uid}"${name ? ` data-name="${esc(name)}"` : ''}>${inner}</g>`;
}

/** cam：三维旋转投影（style/camera.ts），在平面内旋转之后、平移之前 */
export function boxTransform(b: Box, cam?: string): string {
  let t = `translate(${n2(b.x)} ${n2(b.y)})`;
  if (cam) t += ` ${cam}`;
  if (b.rot) t += ` rotate(${n2(b.rot)} ${n2(b.w / 2)} ${n2(b.h / 2)})`;
  return t;
}

/**
 * 放到位置框里：有透视投影（proj）时 body 先在框里转好、再按网格三角形透视（style/perspective.ts），
 * 否则一个变换（cam 是正交投影或透视的仿射近似）。overlay（形状上的文字）总是用 cam 的仿射近似，画在上面——
 * 文字里有段落动画编号，不能复制多份。attrs 加在最外层的 g 上
 */
export function placeBox(b: Box, body: string, doc: SvgDoc, cam?: string, proj?: (x: number, y: number) => [number, number], attrs = '', overlay = ''): string {
  if (!proj) return `<g${attrs} transform="${boxTransform(b, cam)}">${body}${overlay}</g>`;
  const rotated = b.rot ? `<g transform="rotate(${n2(b.rot)} ${n2(b.w / 2)} ${n2(b.h / 2)})">${body}</g>` : body;
  const over = overlay ? `<g transform="${boxTransform({ ...b, x: 0, y: 0 }, cam)}">${overlay}</g>` : '';
  return `<g${attrs} transform="translate(${n2(b.x)} ${n2(b.y)})">${perspectiveMesh(rotated, proj, b.w, b.h, doc)}${over}</g>`;
}

export function flipTransform(b: Box): string {
  if (!b.flipH && !b.flipV) return '';
  return ` transform="translate(${b.flipH ? n2(b.w) : 0} ${b.flipV ? n2(b.h) : 0}) scale(${b.flipH ? -1 : 1} ${b.flipV ? -1 : 1})"`;
}
