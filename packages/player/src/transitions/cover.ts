/** 覆盖：新页滑进来盖住旧页 */
import { motion, type TransitionEffect } from './transition';

export const cover: TransitionEffect = {
  type: 'cover',
  run(_old, el, t, dur) {
    const { off, none } = motion(t);
    return el.animate([{ transform: off }, { transform: none }], { duration: dur, easing: 'ease-out' });
  },
};
