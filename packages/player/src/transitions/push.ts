/** 推入：新页把旧页推出去 */
import { motion, type TransitionEffect } from './transition';

export const push: TransitionEffect = {
  type: 'push',
  run(old, el, t, dur) {
    const { off, away, none } = motion(t);
    old.animate([{ transform: none }, { transform: away }], { duration: dur, easing: 'ease-in-out' });
    return el.animate([{ transform: off }, { transform: none }], { duration: dur, easing: 'ease-in-out' });
  },
};
