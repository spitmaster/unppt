/** 内阴影：盖在形状上面。实测：阴影出现在 dir 指向的那一侧（往右下偏移时右边和下边变暗） */
import { colorIn, css } from '../model/color';
import { n2 } from '../common/svg';
import { dirRad, px, type ShapeEffect } from './shape-effect';

export const innerShadow: ShapeEffect = {
  tag: 'a:innerShdw',
  build(el, colors) {
    const c = colorIn(el, colors) ?? { r: 0, g: 0, b: 0, a: 0.5 };
    const blur = px(el, 'blurRad'), dist = px(el, 'dist');
    const dir = dirRad(el);
    return {
      primitives: `<feComponentTransfer in="SourceAlpha" result="inv"><feFuncA type="table" tableValues="1 0"/></feComponentTransfer><feOffset in="inv" dx="${n2(-Math.cos(dir) * dist)}" dy="${n2(-Math.sin(dir) * dist)}"/><feGaussianBlur stdDeviation="${n2(blur / 2)}" result="ib"/><feFlood flood-color="${css(c)}" flood-opacity="${n2(c.a)}"/><feComposite in2="ib" operator="in"/><feComposite in2="SourceAlpha" operator="in" result="ish"/>`,
      result: 'ish', place: 'over', extent: 0,
    };
  },
};
