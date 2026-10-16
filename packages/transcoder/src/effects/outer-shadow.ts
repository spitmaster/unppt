/** 外阴影：画在形状下面 */
import { colorIn, css } from '../model/color';
import { n2 } from '../common/svg';
import { dirRad, px, type ShapeEffect } from './shape-effect';

/**
 * 模糊半径 -> 高斯模糊的标准差。实测（text-shadow-blur：距离 0 的红色阴影，模糊 10/20/40 磅的矩形，从边缘往外量
 * 降到 1/2、1/4、1/10 的距离）：PowerPoint 的标准差约是模糊半径的 0.34（不是 CSS 习惯的 1/2，那样宽了约一半）
 */
export const SHADOW_SIGMA = 0.34;

export const outerShadow: ShapeEffect = {
  tag: 'a:outerShdw',
  build(el, colors) {
    const c = colorIn(el, colors) ?? { r: 0, g: 0, b: 0, a: 0.4 };
    const blur = px(el, 'blurRad'), dist = px(el, 'dist');
    const dir = dirRad(el);
    return {
      primitives: `<feGaussianBlur in="SourceAlpha" stdDeviation="${n2(blur * SHADOW_SIGMA)}"/><feOffset dx="${n2(Math.cos(dir) * dist)}" dy="${n2(Math.sin(dir) * dist)}" result="osb"/><feFlood flood-color="${css(c)}" flood-opacity="${n2(c.a)}"/><feComposite in2="osb" operator="in" result="osh"/>`,
      result: 'osh', place: 'under', extent: blur + dist,
    };
  },
};
