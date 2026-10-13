/** 飞入 / 飞出：从幻灯片边缘外移进来 */
import { reversible, type AnimEffect } from './anim-effect';

export const fly: AnimEffect = {
  name: 'fly',
  keyframes(a, el, slideW, slideH) {
    let bb = { x: 0, y: 0, width: 0, height: 0 };
    try { bb = (el as SVGGraphicsElement).getBBox(); } catch { /* 未渲染时取不到 */ }
    const from = a.from ?? 'b';
    const off = from === 'b' ? `translate(0px,${slideH - bb.y}px)` : from === 't' ? `translate(0px,${-(bb.y + bb.height)}px)`
      : from === 'l' ? `translate(${-(bb.x + bb.width)}px,0px)` : `translate(${slideW - bb.x}px,0px)`;
    return { frames: reversible(a, [{ transform: off }, { transform: 'translate(0px,0px)' }]), easing: a.dir === 'out' ? 'ease-in' : 'ease-out' };
  },
};
