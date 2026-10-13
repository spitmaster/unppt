/** 圆形：从中心圆形展开 */
import type { TransitionEffect } from './transition';

export const circle: TransitionEffect = {
  type: 'circle',
  run: (_old, el, _t, dur) => el.animate([{ clipPath: 'circle(0% at 50% 50%)' }, { clipPath: 'circle(71% at 50% 50%)' }], { duration: dur }),
};
