/** 没有可还原终态的强调动画：轻微放大再复原，提示"这里有动画" */
import type { AnimEffect } from './anim-effect';

export const emphasis: AnimEffect = {
  name: 'emphasis',
  keyframes: () => ({ frames: [{ transform: 'scale(1)' }, { transform: 'scale(1.1)' }, { transform: 'scale(1)' }], easing: 'ease-in-out' }),
};
