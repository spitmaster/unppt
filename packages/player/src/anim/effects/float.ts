/** 浮入：从下方一点点升上来并淡入 */
import { reversible, type AnimEffect } from './anim-effect';

export const float: AnimEffect = {
  name: 'float',
  keyframes: (a) => ({ frames: reversible(a, [{ transform: 'translate(0px,40px)', opacity: 0 }, { transform: 'translate(0px,0px)', opacity: 1 }]), easing: 'ease-out' }),
};
