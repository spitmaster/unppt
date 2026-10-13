/** 揭开：旧页在上面移走，露出下面的新页。斜向时旧页加速移走，四成时间就离开画面 */
import { EASE, motion, type TransitionEffect } from './transition';

export const pull: TransitionEffect = {
  type: 'pull',
  run(old, _el, t, dur) {
    const { away, none, diagonal } = motion(t);
    old.style.zIndex = '1';
    const frames: Keyframe[] = diagonal
      ? [{ transform: none, easing: 'cubic-bezier(0.7, 0, 0.5, 0.7)' }, { transform: away, offset: 0.4 }, { transform: away }]
      : [{ transform: none, easing: EASE.slide }, { transform: away }];
    return old.animate(frames, { duration: dur, fill: 'forwards' });
  },
};
