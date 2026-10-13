/** 缩放：从无到原大小 */
import { reversible, type AnimEffect } from './anim-effect';

export const zoom: AnimEffect = {
  name: 'zoom',
  keyframes: (a) => ({ frames: reversible(a, [{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }]), easing: 'ease-out' }),
};
