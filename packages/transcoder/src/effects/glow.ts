/** 发光：形状外扩一圈再羽化，画在形状下面 */
import { colorIn, css } from '../model/color';
import { n2 } from '../common/svg';
import { px, type ShapeEffect } from './shape-effect';

/** 外扩半径和羽化程度相对于 rad 的比例（按 PowerPoint 截图校准） */
const GLOW_SPREAD = 0.4;
const GLOW_BLUR = 0.25;

export const glow: ShapeEffect = {
  tag: 'a:glow',
  build(el, colors) {
    const r = px(el, 'rad');
    const c = colorIn(el, colors) ?? { r: 255, g: 255, b: 255, a: 1 };
    return {
      primitives: `<feMorphology in="SourceAlpha" operator="dilate" radius="${n2(r * GLOW_SPREAD)}"/><feGaussianBlur stdDeviation="${n2(r * GLOW_BLUR)}" result="gb"/><feFlood flood-color="${css(c)}" flood-opacity="${n2(c.a)}"/><feComposite in2="gb" operator="in" result="glw"/>`,
      result: 'glw', place: 'under', extent: r,
    };
  },
};
