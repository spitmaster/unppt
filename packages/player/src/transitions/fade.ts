/** 淡入（也是没注册的切换的默认画法） */
import type { TransitionEffect } from './transition';

export const fade: TransitionEffect = {
  type: 'fade',
  run: (_old, el, _t, dur) => el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dur }),
};
