/** 轮子：从 12 点方向顺时针扫开，轮辐数由 variant 给出 */
import { reversible, type AnimEffect } from './anim-effect';
import { sample, wedges } from '../../clip';

export const wheel: AnimEffect = {
  name: 'wheel',
  keyframes(a) {
    const n = Math.max(1, Math.min(8, Number(a.variant) || 1));
    return { frames: reversible(a, sample(12, (p) => ({ clipPath: wedges(n, p) }))), easing: 'linear' };
  },
};
