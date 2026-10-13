/** 擦除：从一侧逐渐露出 */
import { reversible, type AnimEffect } from './anim-effect';

export const wipe: AnimEffect = {
  name: 'wipe',
  keyframes(a) {
    const from = a.from ?? 'l';
    const start = from === 'l' ? 'inset(0 100% 0 0)' : from === 'r' ? 'inset(0 0 0 100%)' : from === 't' ? 'inset(0 0 100% 0)' : 'inset(100% 0 0 0)';
    return { frames: reversible(a, [{ clipPath: start }, { clipPath: 'inset(0 0 0 0)' }]), easing: 'linear' };
  },
};
