/**
 * 渐变色标。实测 PowerPoint 有两种画法：
 *   - 正好两个色标、分别在 0% 和 100%：颜色在线性光空间里混合，并按 smoothstep（3t² - 2t³）缓动
 *     （两头变化慢、中间快；线性和径向、形状填充、线条、背景、各种颜色都吻合到 3 个色阶以内）；
 *   - 其它（三个以上色标，或色标不在两端）：普通的 sRGB 线性插值（吻合到 0.4 个色阶）。
 * SVG 渐变只能在 sRGB 里线性插值，所以第一种在两个色标之间补中间色标来逼近。
 */
import { css, type Rgba } from '../model/color';
import { n2 } from '../common/svg';

/** 每段补多少个中间色标 */
const STEPS = 8;

const toLinear = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const toSrgb = (l: number) => Math.round(255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055));

function mixLinear(a: Rgba, b: Rgba, t: number): Rgba {
  const m = (x: number, y: number) => toSrgb(toLinear(x) * (1 - t) + toLinear(y) * t);
  return { r: m(a.r, b.r), g: m(a.g, b.g), b: m(a.b, b.b), a: a.a + (b.a - a.a) * t };
}

/** 生成 SVG 的 <stop> 列表；adjust 用来按路径模式（变亮、变暗）调整颜色 */
export function gradientStops(stops: { pos: number; color: Rgba }[], adjust: (c: Rgba) => Rgba = (c) => c): string {
  const out: string[] = [];
  const stop = (pos: number, c: Rgba) => {
    const a = adjust(c);
    out.push(`<stop offset="${n2(pos)}" stop-color="${css(a)}"${a.a < 0.999 ? ` stop-opacity="${n2(a.a)}"` : ''}/>`);
  };
  const [first, last] = stops;
  if (stops.length !== 2 || Math.min(first.pos, last.pos) !== 0 || Math.max(first.pos, last.pos) !== 1) {
    for (const s of stops) stop(s.pos, s.color);
    return out.join('');
  }
  const [a, b] = first.pos === 0 ? [first, last] : [last, first];
  for (let k = 0; k <= STEPS; k++) {
    const t = k / STEPS;
    stop(t, k === 0 ? a.color : k === STEPS ? b.color : mixLinear(a.color, b.color, t * t * (3 - 2 * t)));
  }
  return out.join('');
}
