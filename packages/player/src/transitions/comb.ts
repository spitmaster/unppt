/**
 * 梳理：画面切成 7 条，新页的条交替从两侧进来（PowerPoint 是连同内容滑进来，这里画成从两侧擦入）。
 * 横向（horz）的条左右进出；纵向上下进出，路程短，用的时间也短（实测）
 */
import { cosine } from './soft-edge';
import type { Rect } from './tiles';
import { tileTransition } from './tiles';
import type { TransitionEffect } from './transition';

const STRIPS = 7;

export const comb: TransitionEffect = {
  type: 'comb',
  run(_old, el, t, dur) {
    const vert = t.orient === 'vert';
    const [s, e] = vert ? [0.24, 0.73] : [0.21, 0.94];
    const size = 100 / STRIPS;
    return tileTransition(el, dur, (u) => {
      const p = cosine((u - s) / (e - s)) * 100;
      if (p <= 0) return [];
      const out: Rect[] = [];
      for (let i = 0; i < STRIPS; i++) {
        const [a, b] = i % 2 ? [100 - p, 100] : [0, p];
        out.push(vert ? [i * size, a, (i + 1) * size, b] : [a, i * size, b, (i + 1) * size]);
      }
      return out;
    });
  },
};
