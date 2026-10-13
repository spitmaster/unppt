/**
 * 形状：圆形、方框、菱形、加号逐渐露出。向外 = 形状从中心长大；向内 = 从四周往中心合拢露出。
 * 向内需要"外框减去形状"的镂空，用 clip-path: path(evenodd, ...)，坐标取元素外框的像素尺寸。
 */
import { reversible, type AnimEffect } from './anim-effect';
import { sample } from '../../clip';

export type Outline = (cx: number, cy: number, w: number, h: number, s: number) => string;

/** 形状轮廓：s 是进度（0~1），1 时刚好盖住整个外框 */
export const OUTLINES: Record<string, Outline> = {
  // 圆形其实是和外框同比例的椭圆，s = 1 时是外接椭圆（实测）
  circle(cx, cy, w, h, s) {
    const rx = (w / 2) * Math.SQRT2 * s, ry = (h / 2) * Math.SQRT2 * s;
    return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
  },
  box(cx, cy, w, h, s) {
    const x = (w / 2) * s, y = (h / 2) * s;
    return `M${cx - x} ${cy - y}H${cx + x}V${cy + y}H${cx - x}Z`;
  },
  diamond(cx, cy, w, h, s) {
    const x = w * s, y = h * s;
    return `M${cx} ${cy - y}L${cx + x} ${cy}L${cx} ${cy + y}L${cx - x} ${cy}Z`;
  },
  // 加号：横竖两条贯穿整个外框的带，宽度随 s 从 0 长到满（实测）
  plus(cx, cy, w, h, s) {
    const tx = (w * s) / 2, ty = (h * s) / 2, x0 = cx - w / 2, y0 = cy - h / 2, x1 = cx + w / 2, y1 = cy + h / 2;
    return `M${cx - tx} ${y0}H${cx + tx}V${cy - ty}H${x1}V${cy + ty}H${cx + tx}V${y1}H${cx - tx}V${cy + ty}H${x0}V${cy - ty}H${cx - tx}Z`;
  },
};

export const shape: AnimEffect = {
  name: 'shape',
  keyframes(a, el) {
    let bb = { width: 0, height: 0 };
    try { bb = (el as SVGGraphicsElement).getBBox(); } catch { /* 未渲染时取不到 */ }
    const [kind, way] = (a.variant ?? 'circle-out').split('-');
    const outline = OUTLINES[kind] ?? OUTLINES.circle;
    const { width: w, height: h } = bb;
    if (!w || !h) return { frames: reversible(a, [{ opacity: 0 }, { opacity: 1 }]), easing: 'linear' };
    const cx = w / 2, cy = h / 2;
    const frames = way === 'in'
      ? sample(8, (p) => ({ clipPath: `path(evenodd, "M0 0H${w}V${h}H0Z${outline(cx, cy, w, h, 1 - p)}")` }))
      : sample(8, (p) => ({ clipPath: `path("${outline(cx, cy, w, h, p)}")` }));
    return { frames: reversible(a, frames), easing: 'linear' };
  },
};
