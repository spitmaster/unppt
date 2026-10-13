/** 溶解：画面分成 54 x 40 的小块，按随机顺序匀速出现（实测约在 3%~97% 的时间里） */
import { gridRects, shuffled, tileTransition } from './tiles';
import type { TransitionEffect } from './transition';

const COLS = 54, ROWS = 40;

export const dissolve: TransitionEffect = {
  type: 'dissolve',
  run(_old, el, _t, dur) {
    const n = COLS * ROWS;
    const rank = shuffled(n, 11);
    return tileTransition(el, dur, (u) => {
      const shown = Math.max(0, Math.min(1, (u - 0.03) / 0.94)) * n;
      return gridRects((r, c) => rank[r * COLS + c] < shown, ROWS, COLS, 100 / COLS, 100 / ROWS);
    });
  },
};
