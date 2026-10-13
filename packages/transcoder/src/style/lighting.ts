/**
 * 三维形状（a:sp3d：棱台、拉伸等）的光照。PowerPoint 用默认的"三点"灯光渲染三维形状，
 * 正面会被照亮一点。实测（10 种颜色，有无棱台高度都一样）：每个通道 min(255, 1.036 × 原值 + 5)。
 * 棱台边缘的高光、阴影还没画。
 */
import { child, type XEl } from '../io/xml';
import type { Rgba } from '../model/color';
import type { Fill } from './fill';

/** a:sp3d 里真的开了三维（有棱台、拉伸、轮廓或材质）才算 */
export function has3d(sp3d: XEl | undefined): boolean {
  if (!sp3d) return false;
  return !!(child(sp3d, 'a:bevelT') || child(sp3d, 'a:bevelB') || Number(sp3d.attrs.extrusionH ?? 0) > 0 || Number(sp3d.attrs.contourW ?? 0) > 0 || sp3d.attrs.prstMaterial);
}

const lit = (c: Rgba): Rgba => {
  const f = (v: number) => Math.min(255, Math.round(1.036 * v + 5));
  return { r: f(c.r), g: f(c.g), b: f(c.b), a: c.a };
};

/** 正面在三维光照下的填充 */
export function litFill(fill: Fill | undefined): Fill | undefined {
  if (!fill) return fill;
  switch (fill.kind) {
    case 'solid': return { ...fill, color: lit(fill.color) };
    case 'grad': return { ...fill, stops: fill.stops.map((s) => ({ ...s, color: lit(s.color) })) };
    case 'pattern': return { ...fill, fg: lit(fill.fg), bg: lit(fill.bg) };
    default: return fill;
  }
}
