/** 分割：向外展开新页，或向内合拢旧页 */
import type { TransitionEffect } from './transition';

export const split: TransitionEffect = {
  type: 'split',
  run(old, el, t, dur) {
    const closed = t.orient === 'vert' ? 'inset(0 50% 0 50%)' : 'inset(50% 0 50% 0)';
    if (t.inOut === 'in') {
      // 向内合拢：旧页从两边往中间收拢消失
      old.style.zIndex = '1';
      return old.animate([{ clipPath: 'inset(0 0 0 0)' }, { clipPath: closed }], { duration: dur, fill: 'forwards' });
    }
    return el.animate([{ clipPath: closed }, { clipPath: 'inset(0 0 0 0)' }], { duration: dur });
  },
};
