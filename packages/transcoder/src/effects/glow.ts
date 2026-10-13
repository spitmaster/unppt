/** 发光：外扩一圈再羽化，画在下面。形状和文字的观感不同，各用一组按 PowerPoint 截图校准的参数 */
import { colorIn, css } from '../model/color';
import { n2 } from '../common/svg';
import { px, type ShapeEffect } from './shape-effect';

/** spread：外扩半径、blur：羽化程度，都是相对 rad 的比例 */
function makeGlow(spread: number, blur: number): ShapeEffect {
  return {
    tag: 'a:glow',
    build(el, colors) {
      const r = px(el, 'rad');
      const c = colorIn(el, colors) ?? { r: 255, g: 255, b: 255, a: 1 };
      return {
        primitives: `<feMorphology in="SourceAlpha" operator="dilate" radius="${n2(r * spread)}"/><feGaussianBlur stdDeviation="${n2(r * blur)}" result="gb"/><feFlood flood-color="${css(c)}" flood-opacity="${n2(c.a)}"/><feComposite in2="gb" operator="in" result="glw"/>`,
        result: 'glw', place: 'under', extent: r,
      };
    },
  };
}

export const glow = makeGlow(0.4, 0.25);
export const textGlow = makeGlow(0.25, 0.12);
