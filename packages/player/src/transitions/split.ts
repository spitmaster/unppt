/**
 * 分割：从中线向两侧展开（out），或从两边向中线合拢（in），软边宽度等于半个画面。
 * orient 是分割线的方向：vert 时左右展开
 */
import { maskTransition, twoSides } from './soft-edge';
import type { TransitionEffect } from './transition';

export const split: TransitionEffect = {
  type: 'split',
  run(_old, el, t, dur) {
    const to = t.orient === 'vert' ? 'to right' : 'to bottom';
    const way = t.inOut === 'in' ? 'in' : 'out';
    return maskTransition(el, el, dur, (u) => `linear-gradient(${to},${twoSides(u, 1, way)})`);
  },
};
