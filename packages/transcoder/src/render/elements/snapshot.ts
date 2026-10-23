/**
 * 公式（a14:m）改用 Fallback 时的图片填充（io/xml.ts 的 SNAPSHOT 标记）：PowerPoint 另存时按公式在幻灯片上最终的样子截图——
 * 已经转好、翻好（水平翻转的文字不镜像，垂直翻转的转 180°），铺满形状转动后轮廓的外接矩形，有边框时连边框一起（每边外扩半个线宽）。
 * 所以图片正着铺在这个矩形里，不跟着形状转、翻（实测 equations-rot-flip：转 90°/270° 的框图片是横竖互换的，
 * 转 30° 的是外接矩形大小，像素尺寸都是外接矩形 × 150 dpi；3 磅边框的椭圆每边多 1.5 磅）。
 * 不转不翻、没有边框时就是形状框本身，照常拉伸，不用换
 */
import type { GeomDef } from '../../geometry/geometry';
import { turnedBounds } from '../../geometry/turned-bounds';
import type { FillArea } from '../../style/fill';
import type { Box } from '../box';

export function snapshotArea(def: GeomDef, b: Box, av: Map<string, string>, lineWidth: number): FillArea | undefined {
  if (!b.rot && !b.flipH && !b.flipV && !lineWidth) return undefined;
  const t = turnedBounds(def, b.w, b.h, av, b.rot, b.flipH, b.flipV);
  if (!t) return undefined;
  const e = lineWidth / 2;
  return { x: b.x + t.x - e, y: b.y + t.y - e, w: t.w + 2 * e, h: t.h + 2 * e };
}
