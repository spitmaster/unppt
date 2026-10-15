/**
 * 形状外框对齐整像素（实测，见 SPEC 第 7 节）：PowerPoint 画形状时先把外框四边取整到整像素（输出图的像素，
 * 坐标换算见 SlideContext.toSlide 和 DISPLAY_WIDTH）
 * （左上 round(x)、右下 round(x + w)，0.5 进位），在取整后的框里照常画（斜边、曲线、框内部的边仍有抗锯齿），
 * 所以矩形的边是不发虚的实线；描边四舍五入后是奇数像素宽时再整体挪半个像素，横竖的边框正好占满整行（列）像素。
 * 文字不跟着挪。只对不转动的形状；在转动、翻转的组合里不知道幻灯片坐标，不对齐。
 */
import type { SlideMapping } from '../model/model';
import type { Box } from './box';

export interface SnappedBox {
  /** 几何相对原外框左上角的挪动（框内坐标），以及取整后的宽高 */
  dx: number; dy: number; w: number; h: number;
}

/** strokeW 是描边宽度（像素，没有描边时 0）；不对齐时返回 undefined */
export function snapBox(box: Box, m: SlideMapping | null | undefined, strokeW: number): SnappedBox | undefined {
  if (box.rot % 360 !== 0) return undefined;
  const o = m === undefined ? { x: 0, y: 0, sx: 1, sy: 1 } : m;
  if (!o) return undefined;
  const X0 = Math.round(o.x + o.sx * box.x), X1 = Math.round(o.x + o.sx * (box.x + box.w));
  const Y0 = Math.round(o.y + o.sy * box.y), Y1 = Math.round(o.y + o.sy * (box.y + box.h));
  // 有宽度的形状取整后不能变成 0
  if ((box.w > 0 && X1 === X0) || (box.h > 0 && Y1 === Y0)) return undefined;
  const half = strokeW > 0 && Math.max(1, Math.round(strokeW * o.sx)) % 2 === 1 ? 0.5 : 0;
  return {
    dx: (X0 + half - o.x) / o.sx - box.x, dy: (Y0 + half - o.y) / o.sy - box.y,
    w: (X1 - X0) / o.sx, h: (Y1 - Y0) / o.sy,
  };
}

/**
 * 文字基线对齐用：y（当前坐标）在对齐像素里的位置和比例。只在当前坐标系除了顶层的显示比例没有别的缩放时给
 * （组合缩放过的不对齐，实测规则只在不缩放时成立）
 */
export function pixelRow(m: SlideMapping | null | undefined, y: number, rootScale: number): { pixelTop: number; pixelScale: number } | undefined {
  const o = m === undefined ? { x: 0, y: 0, sx: 1, sy: 1 } : m;
  if (!o || o.sx !== o.sy || Math.abs(o.sy - rootScale) > 1e-9) return undefined;
  return { pixelTop: o.y + o.sy * y, pixelScale: o.sy };
}
