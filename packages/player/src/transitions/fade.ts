/**
 * 淡入（也是没注册的切换的默认画法）：余弦速度曲线。
 * 穿过黑色：前一半旧页变黑，后一半新页从黑色亮起来（各自余弦曲线）
 */
import { EASE, type TransitionEffect } from './transition';

export const fade: TransitionEffect = {
  type: 'fade',
  run(old, el, t, dur) {
    if (!t.thruBlk) return el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dur, easing: EASE.cosine });
    old.animate([{ filter: 'brightness(1)', easing: EASE.cosine }, { filter: 'brightness(0)', offset: 0.5 }, { filter: 'brightness(0)' }], { duration: dur, fill: 'forwards' });
    return el.animate([
      { opacity: 0, filter: 'brightness(0)' },
      { opacity: 0, filter: 'brightness(0)', offset: 0.5 },
      { opacity: 1, filter: 'brightness(0)', offset: 0.5, easing: EASE.cosine },
      { opacity: 1, filter: 'brightness(1)' },
    ], { duration: dur });
  },
};
