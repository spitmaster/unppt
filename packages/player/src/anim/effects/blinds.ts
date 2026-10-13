/** 百叶窗（6 条）；随机线条用很多条细的百叶窗近似（variant 里带条数，如 horz-24） */
import { reversible, type AnimEffect } from './anim-effect';
import { bands, sample } from '../../clip';

export const blinds: AnimEffect = {
  name: 'blinds',
  keyframes(a) {
    const [axis, count] = (a.variant ?? 'horz').split('-');
    const n = Math.max(2, Math.min(40, Number(count) || 6));
    return { frames: reversible(a, sample(4, (p) => ({ clipPath: bands(n, p, axis !== 'vert') }))), easing: 'linear' };
  },
};
