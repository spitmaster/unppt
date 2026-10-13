/** 劈裂：从中间向两边展开 */
import { reversible, type AnimEffect } from './anim-effect';

export const split: AnimEffect = {
  name: 'split',
  keyframes: (a) => ({ frames: reversible(a, [{ clipPath: 'inset(0 50% 0 50%)' }, { clipPath: 'inset(0 0 0 0)' }]), easing: 'ease-out' }),
};
