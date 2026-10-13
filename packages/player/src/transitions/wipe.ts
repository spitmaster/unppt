/** 擦除：从运动方向的反侧开始露出（向左擦除时从右边缘露出） */
import type { TransitionEffect } from './transition';

export const wipe: TransitionEffect = {
  type: 'wipe',
  run(_old, el, t, dur) {
    const dir = t.dir ?? 'l';
    const start = dir === 'l' ? 'inset(0 0 0 100%)' : dir === 'r' ? 'inset(0 100% 0 0)' : dir === 'u' ? 'inset(100% 0 0 0)' : 'inset(0 0 100% 0)';
    return el.animate([{ clipPath: start }, { clipPath: 'inset(0 0 0 0)' }], { duration: dur });
  },
};
