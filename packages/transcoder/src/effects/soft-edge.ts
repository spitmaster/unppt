/** 柔化边缘：边缘向内逐渐透明 */
import { n2 } from '../common/svg';
import { px, type ShapeEffect } from './shape-effect';

/** 模糊半径（相对 rad）、透明度从 SOFT_CUT 起按 SOFT_SLOPE 倍拉陡（按 PowerPoint 截图校准） */
const SOFT_BLUR = 0.7;
const SOFT_SLOPE = 4;
const SOFT_CUT = 0.75;

export const softEdge: ShapeEffect = {
  tag: 'a:softEdge',
  build(el) {
    const r = px(el, 'rad');
    // 先把透明度模糊（边缘处约 0.5），再拉陡：边缘处变成全透明、往里 rad 左右变成不透明（不用腐蚀，椭圆不会出棱角）
    return {
      primitives: `<feGaussianBlur in="SourceAlpha" stdDeviation="${n2(r * SOFT_BLUR)}"/><feComponentTransfer result="se"><feFuncA type="linear" slope="${SOFT_SLOPE}" intercept="${n2(-SOFT_CUT * SOFT_SLOPE)}"/></feComponentTransfer><feComposite in="SourceGraphic" in2="se" operator="in" result="soft"/>`,
      result: 'soft', place: 'source', extent: 0,
    };
  },
};
