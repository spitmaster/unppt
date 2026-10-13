/** 揭开：旧页在上面移走，露出下面的新页 */
import { motion, type TransitionEffect } from './transition';

export const pull: TransitionEffect = {
  type: 'pull',
  run(old, _el, t, dur) {
    const { away, none } = motion(t);
    old.style.zIndex = '1';
    return old.animate([{ transform: none }, { transform: away }], { duration: dur, easing: 'ease-in', fill: 'forwards' });
  },
};
