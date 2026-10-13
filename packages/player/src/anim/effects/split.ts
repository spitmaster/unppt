/** 劈裂：竖向 / 横向，向外（从中间往两边展开）或向内（从两边往中间合拢） */
import { reversible, type AnimEffect } from './anim-effect';
import { polygon, sample } from '../../clip';

export const split: AnimEffect = {
  name: 'split',
  keyframes(a) {
    const [axis, way] = (a.variant ?? 'vert-out').split('-');
    const vert = axis !== 'horz';
    let frames: Keyframe[];
    if (way === 'in') {
      // 两条从边缘长出的带（中间用零宽的线连成一个多边形）
      frames = sample(4, (p) => {
        const d = 50 * p;
        const pts: [number, number][] = [[0, 0], [d, 0], [d, 100], [100 - d, 100], [100 - d, 0], [100, 0], [100, 100], [0, 100]];
        return { clipPath: polygon(vert ? pts : pts.map(([x, y]) => [y, x])) };
      });
    } else {
      frames = vert
        ? [{ clipPath: 'inset(0 50% 0 50%)' }, { clipPath: 'inset(0 0 0 0)' }]
        : [{ clipPath: 'inset(50% 0 50% 0)' }, { clipPath: 'inset(0 0 0 0)' }];
    }
    return { frames: reversible(a, frames), easing: 'ease-out' };
  },
};
