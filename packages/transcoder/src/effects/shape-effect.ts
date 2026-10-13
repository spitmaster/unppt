/**
 * 扩展点：形状效果（a:effectLst 里的一种效果）-> SVG 滤镜的一层。
 * 加一种效果：新建一个实现 ShapeEffect 的文件，在 effects.ts 的 SHAPE_EFFECTS 里按画的先后顺序加一行。
 * 映像（reflection）要复制整个图形，不是滤镜，见 reflection.ts。
 */
import type { ColorContext } from '../model/color';
import { numAttr, type XEl } from '../io/xml';
import { EMU_PER_PX } from '../model/model';

export interface FilterLayer {
  /** 这一层的滤镜原语（SVG 片段），最后一个原语的 result 要等于 result */
  primitives: string;
  result: string;
  /** under：画在形状下面（阴影、发光）；source：替换形状本身（柔化边缘）；over：盖在形状上面（内阴影） */
  place: 'under' | 'source' | 'over';
  /** 效果伸出形状边界的距离（像素），用来放大滤镜区域 */
  extent: number;
}

export interface ShapeEffect {
  /** effectLst 里对应的元素名，例如 a:glow */
  readonly tag: string;
  build(el: XEl, colors: ColorContext): FilterLayer | undefined;
}

/** 效果参数里的长度（EMU）-> 像素 */
export const px = (el: XEl | undefined, name: string) => (numAttr(el, name) ?? 0) / EMU_PER_PX;
/** 方向（1/60000 度）-> 弧度 */
export const dirRad = (el: XEl | undefined) => ((numAttr(el, 'dir') ?? 0) / 60000) * Math.PI / 180;
