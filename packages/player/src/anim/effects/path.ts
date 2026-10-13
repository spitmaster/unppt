/** 没有路径数据的路径动画：保持不动 */
import type { AnimEffect } from './anim-effect';

export const path: AnimEffect = {
  name: 'path',
  keyframes: () => ({ frames: [{ opacity: 1 }, { opacity: 1 }], easing: 'linear' }),
};
