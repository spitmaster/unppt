/** 新闻快报：新页从中心旋转着匀速放大（逆时针转 400 度，实测） */
import type { TransitionEffect } from './transition';

export const newsflash: TransitionEffect = {
  type: 'newsflash',
  run: (_old, el, _t, dur) => el.animate([{ transform: 'rotate(400deg) scale(0)' }, { transform: 'rotate(0deg) scale(1)' }], { duration: dur }),
};
