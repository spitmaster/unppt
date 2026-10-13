/** 穿过黑色切出：前一半还是旧页，后一半全黑，结束时直接换成新页 */
import type { TransitionEffect } from './transition';

export const cut: TransitionEffect = {
  type: 'cut',
  run: (_old, el, _t, dur) => el.animate([
    { opacity: 0, filter: 'brightness(0)' },
    { opacity: 0, filter: 'brightness(0)', offset: 0.5 },
    { opacity: 1, filter: 'brightness(0)', offset: 0.5 },
    { opacity: 1, filter: 'brightness(0)' },
  ], { duration: dur }),
};
