/** 圆形：软边圆从中心匀速长大（半径以半条对角线为 1，软边宽 0.32） */
import { oneSide, maskTransition } from './soft-edge';
import type { TransitionEffect } from './transition';

export const SHAPE_EDGE = 0.32;

export const circle: TransitionEffect = {
  type: 'circle',
  run: (_old, el, _t, dur) => maskTransition(el, el, dur, (u) => `radial-gradient(circle farthest-corner at 50% 50%,${oneSide(u, SHAPE_EDGE)})`),
};
