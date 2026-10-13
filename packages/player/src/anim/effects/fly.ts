/** 飞入 / 飞出：从幻灯片边缘外移进来 */
import { reversible, slideBox, type AnimEffect } from './anim-effect';

export const fly: AnimEffect = {
  name: 'fly',
  keyframes(a, el, slideW, slideH) {
    const bb = slideBox(el);
    const from = a.from ?? 'b';
    const [dx, dy] = from === 'b' ? bb.local(0, slideH - bb.y) : from === 't' ? bb.local(0, -(bb.y + bb.height))
      : from === 'l' ? bb.local(-(bb.x + bb.width), 0) : bb.local(slideW - bb.x, 0);
    const off = `translate(${dx}px,${dy}px)`;
    return { frames: reversible(a, [{ transform: off }, { transform: 'translate(0px,0px)' }]), easing: a.dir === 'out' ? 'ease-in' : 'ease-out' };
  },
};
