/**
 * 菱形：软边菱形从中心长大（|x|/半宽 + |y|/半高 = 2 时铺满）。
 * 菱形外面是四个半平面的并集，所以把旧页放在上面、给旧页画四层"菱形外"的遮罩
 */
import { SHAPE_EDGE } from './circle';
import { knots, maskTransition, stop } from './soft-edge';
import type { TransitionEffect } from './transition';

const CORNERS = ['to bottom right', 'to bottom left', 'to top right', 'to top left'];

export const diamond: TransitionEffect = {
  type: 'diamond',
  run(old, el, _t, dur) {
    old.style.zIndex = '1';
    // 朝某个角的渐变：0% 在对角，100% 在这个角；这个象限里 d = 2p - 1，即 p = (1 + d) / 2
    return maskTransition(old, el, dur, (u) => {
      const stops = knots(u, SHAPE_EDGE).map(([d, a]) => stop(1 - a, 50 + d * 50, '%')).join(',');
      return CORNERS.map((c) => `linear-gradient(${c},${stops})`).join(',');
    });
  },
};
