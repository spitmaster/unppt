/** 外阴影：画在形状下面 */
import { colorIn, css } from '../model/color';
import { n2 } from '../common/svg';
import { dirRad, px, type ShapeEffect } from './shape-effect';

export const outerShadow: ShapeEffect = {
  tag: 'a:outerShdw',
  build(el, colors) {
    const c = colorIn(el, colors) ?? { r: 0, g: 0, b: 0, a: 0.4 };
    const blur = px(el, 'blurRad'), dist = px(el, 'dist');
    const dir = dirRad(el);
    return {
      primitives: `<feGaussianBlur in="SourceAlpha" stdDeviation="${n2(blur / 2)}"/><feOffset dx="${n2(Math.cos(dir) * dist)}" dy="${n2(Math.sin(dir) * dist)}" result="osb"/><feFlood flood-color="${css(c)}" flood-opacity="${n2(c.a)}"/><feComposite in2="osb" operator="in" result="osh"/>`,
      result: 'osh', place: 'under', extent: blur + dist,
    };
  },
};
