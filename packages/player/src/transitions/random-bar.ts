/** 随机线条：很多细线按随机顺序出现，出现的比例按余弦曲线增长（实测约在 12%~89% 的时间里） */
import { cosine } from './soft-edge';
import { gridRects, shuffled, tileTransition } from './tiles';
import type { TransitionEffect } from './transition';

const BARS = 120;
const cover = (u: number) => cosine((u - 0.12) / 0.77);

export const randomBar: TransitionEffect = {
  type: 'randomBar',
  run(_old, el, t, dur) {
    const rank = shuffled(BARS, 7);
    const size = 100 / BARS;
    return tileTransition(el, dur, (u) => {
      const shown = cover(u) * BARS;
      const on = (_r: number, c: number) => rank[c] < shown;
      // 横向线条：一列格子转置成一行
      return t.orient === 'vert'
        ? gridRects(on, 1, BARS, size, 100)
        : gridRects(on, 1, BARS, size, 100).map(([x0, , x1]) => [0, x0, 100, x1] as [number, number, number, number]);
    });
  },
};
