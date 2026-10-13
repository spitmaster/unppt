/** 擦除：从运动方向的反侧开始，一条和画面一样宽的软边匀速扫过（向左擦除时从右边缘露出） */
import { oneSide, maskTransition } from './soft-edge';
import type { TransitionEffect } from './transition';

const TO: Record<string, string> = { l: 'to left', r: 'to right', u: 'to top', d: 'to bottom' };

export const wipe: TransitionEffect = {
  type: 'wipe',
  run(_old, el, t, dur) {
    const to = TO[t.dir ?? 'l'] ?? TO.l;
    return maskTransition(el, el, dur, (u) => `linear-gradient(${to},${oneSide(u, 1)})`);
  },
};
