/** 加号：横竖两条软边带从中心向外加宽（两层遮罩取并集） */
import { SHAPE_EDGE } from './circle';
import { maskTransition, twoSides } from './soft-edge';
import type { TransitionEffect } from './transition';

export const plus: TransitionEffect = {
  type: 'plus',
  run: (_old, el, _t, dur) => maskTransition(el, el, dur, (u) => {
    const s = twoSides(u, SHAPE_EDGE, 'out');
    return `linear-gradient(to right,${s}),linear-gradient(to bottom,${s})`;
  }),
};
