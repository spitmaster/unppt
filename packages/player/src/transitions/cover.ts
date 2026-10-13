/** 覆盖：新页滑进来盖住旧页。斜向的速度曲线不同：先快后慢，九成时间到位 */
import { EASE, motion, type TransitionEffect } from './transition';

export const cover: TransitionEffect = {
  type: 'cover',
  run(_old, el, t, dur) {
    const { off, none, diagonal } = motion(t);
    if (!diagonal) return el.animate([{ transform: off }, { transform: none }], { duration: dur, easing: EASE.slide });
    return el.animate([{ transform: off, easing: 'cubic-bezier(0.4, 0.3, 0.2, 1)' }, { transform: none, offset: 0.9 }, { transform: none }], { duration: dur });
  },
};
