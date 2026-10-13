/** 条纹：从一角沿对角线方向软边扫过（dir 是运动方向，rd 从左上角开始） */
import { oneSide, maskTransition } from './soft-edge';
import type { TransitionEffect } from './transition';

const TO: Record<string, string> = { lu: 'to top left', ru: 'to top right', ld: 'to bottom left', rd: 'to bottom right' };

export const strips: TransitionEffect = {
  type: 'strips',
  run(_old, el, t, dur) {
    const to = TO[t.dir ?? 'lu'] ?? TO.lu;
    return maskTransition(el, el, dur, (u) => `linear-gradient(${to},${oneSide(u, 0.94)})`);
  },
};
