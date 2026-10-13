/** 扇形：从 12 点方向向两侧对称张开，前沿是软边（宽 0.34 个半圈） */
import { aspectOf, conic } from './conic';
import { alphaAt, knots, maskTransition } from './soft-edge';
import type { TransitionEffect } from './transition';

const EDGE = 0.34;

export const wedge: TransitionEffect = {
  type: 'wedge',
  run(_old, el, _t, dur) {
    const aspect = aspectOf(el);
    return maskTransition(el, el, dur, (u) => {
      const ks = knots(u, EDGE).filter(([d]) => d < 1);
      ks.push([1, alphaAt(u, EDGE, 1)]);
      const right = ks.map(([d, a]): [number, number] => [d * 180, a]);
      const left = [...ks].reverse().map(([d, a]): [number, number] => [360 - d * 180, a]);
      return conic([...right, ...left], aspect);
    });
  },
};
