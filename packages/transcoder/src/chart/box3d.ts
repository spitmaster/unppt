/**
 * 直角坐标轴三维图（斜投影）共用的画法：立方体柱子（右侧面、顶面、正面）和墙上的网格线。
 * 深度方向在屏幕上是 (sin rotY, −sin rotX) × 深度；顶面是正面颜色 × 0.76，侧面 × 0.64（实测）。
 */
import { css, type Rgba } from '../model/color';
import { n2 } from '../common/svg';

const TOP_SHADE = 0.76, SIDE_SHADE = 0.64;
const shadeOf = (c: Rgba, k: number): Rgba => ({ r: Math.round(c.r * k), g: Math.round(c.g * k), b: Math.round(c.b * k), a: c.a });

/** 竖着的柱子：正面左上角 (x, y1)、宽 w、底边 y2；(bdx, bdy) 是柱子的深度在屏幕上的位移 */
export function columnCuboid(x: number, y1: number, y2: number, w: number, bdx: number, bdy: number, color: Rgba): string {
  return `<path d="M${n2(x + w)} ${n2(y1)}l${n2(bdx)} ${n2(bdy)}V${n2(y2 + bdy)}l${n2(-bdx)} ${n2(-bdy)}Z" fill="${css(shadeOf(color, SIDE_SHADE))}"/>`
    + `<path d="M${n2(x)} ${n2(y1)}l${n2(bdx)} ${n2(bdy)}h${n2(w)}l${n2(-bdx)} ${n2(-bdy)}Z" fill="${css(shadeOf(color, TOP_SHADE))}"/>`
    + `<rect x="${n2(x)}" y="${n2(y1)}" width="${n2(w)}" height="${n2(Math.max(0, y2 - y1))}" fill="${css(color)}"/>`;
}

/** 横着的柱子（条形图）：正面从 x1 到 x2、上边 y、高 h */
export function barCuboid(x1: number, x2: number, y: number, h: number, bdx: number, bdy: number, color: Rgba): string {
  return `<path d="M${n2(x2)} ${n2(y)}l${n2(bdx)} ${n2(bdy)}v${n2(h)}l${n2(-bdx)} ${n2(-bdy)}Z" fill="${css(shadeOf(color, SIDE_SHADE))}"/>`
    + `<path d="M${n2(x1)} ${n2(y)}l${n2(bdx)} ${n2(bdy)}H${n2(x2 + bdx)}l${n2(-bdx)} ${n2(-bdy)}Z" fill="${css(shadeOf(color, TOP_SHADE))}"/>`
    + `<rect x="${n2(x1)}" y="${n2(y)}" width="${n2(Math.max(0, x2 - x1))}" height="${n2(h)}" fill="${css(color)}"/>`;
}

/**
 * 网格线：数值在纵向时画在左侧墙（斜线）和背景墙（横线）上，在横向时画在地板（斜线）和背景墙（竖线）上。
 * qs 是各刻度在正面上的坐标，正面是 [fl, fr] × [ft, fb]，(dx, dy) 是墙的深度
 */
export function wallGridPath(qs: number[], horizontal: boolean, fl: number, fr: number, ft: number, fb: number, dx: number, dy: number): string {
  return qs.map((q) => (horizontal
    ? `M${n2(q)} ${n2(fb)}L${n2(q + dx)} ${n2(fb + dy)}V${n2(ft + dy)}`
    : `M${n2(fl)} ${n2(q)}L${n2(fl + dx)} ${n2(q + dy)}H${n2(fr + dx)}`)).join('');
}
