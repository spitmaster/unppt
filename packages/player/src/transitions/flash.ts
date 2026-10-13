/** 闪光：旧页很快亮成白色（露出白色的舞台背景），再从白色淡入新页 */
import { EASE, type TransitionEffect } from './transition';

const WHITE = 0.13;

export const flash: TransitionEffect = {
  type: 'flash',
  run(old, el, _t, dur) {
    // 实测：先匀速亮到一半左右，再一下子变成全白
    old.animate([{ opacity: 1 }, { opacity: 1, offset: 0.02 }, { opacity: 0.5, offset: WHITE - 0.01 }, { opacity: 0, offset: WHITE }, { opacity: 0 }], { duration: dur, fill: 'forwards' });
    return el.animate([{ opacity: 0 }, { opacity: 0, offset: WHITE, easing: EASE.cosine }, { opacity: 1 }], { duration: dur });
  },
};
