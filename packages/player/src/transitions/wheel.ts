/**
 * 轮子：spokes 条轮辐从 12 点方向同时顺时针（ccw 时逆时针）扫过各自的扇区，前沿是软边（宽 0.12 个扇区）。
 * 扇区起点是硬边
 */
import { aspectOf, conic } from './conic';
import { alphaAt, knots, maskTransition } from './soft-edge';
import type { TransitionEffect } from './transition';

const EDGE = 0.12;

export const wheel: TransitionEffect = {
  type: 'wheel',
  run(_old, el, t, dur) {
    const n = Math.max(1, Math.min(8, Math.round(t.spokes ?? 4)));
    const sector = 360 / n;
    const aspect = aspectOf(el);
    return maskTransition(el, el, dur, (u) => {
      const ks = knots(u, EDGE).filter(([d]) => d < 1);
      const end = alphaAt(u, EDGE, 1);
      const pts: [number, number][] = [];
      for (let k = 0; k < n; k++) {
        for (const [d, a] of ks) pts.push([k * sector + d * sector, a]);
        pts.push([(k + 1) * sector, end]);
      }
      const ordered = t.ccw ? pts.map(([deg, a]): [number, number] => [360 - deg, a]).reverse() : pts;
      return conic(ordered, aspect);
    });
  },
};
