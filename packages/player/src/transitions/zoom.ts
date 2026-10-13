/**
 * 盒状：向外时前一半不动、后一半新页从中心的矩形匀速长大；
 * 向内时前一半旧页缩成中心的矩形消失，后一半已经是新页（实测）
 */
import type { TransitionEffect } from './transition';

const FULL = 'inset(0% 0% 0% 0%)', DOT = 'inset(50% 50% 50% 50%)';

export const zoom: TransitionEffect = {
  type: 'zoom',
  run(old, el, t, dur) {
    if (t.inOut === 'in') {
      old.style.zIndex = '1';
      return old.animate([{ clipPath: FULL }, { clipPath: DOT, offset: 0.5 }, { clipPath: DOT }], { duration: dur, fill: 'forwards' });
    }
    return el.animate([{ clipPath: DOT }, { clipPath: DOT, offset: 0.5 }, { clipPath: FULL }], { duration: dur });
  },
};
