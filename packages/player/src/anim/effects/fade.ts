/** 淡入淡出（也是没注册的效果的默认画法） */
import { reversible, type AnimEffect } from './anim-effect';

export const fade: AnimEffect = {
  name: 'fade',
  keyframes: (a) => ({ frames: reversible(a, [{ opacity: 0 }, { opacity: 1 }]), easing: 'linear' }),
};
