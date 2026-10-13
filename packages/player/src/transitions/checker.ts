/**
 * 棋盘：7 x 5 的方块依次翻到新页（PowerPoint 是 3D 翻转，这里画成从方块中线展开）。
 * 横向（horz）从左往右，奇数行错开半格；纵向从上往下。时间窗按实测的露出比例拟合
 */
import { smooth } from './soft-edge';
import type { Rect } from './tiles';
import { tileTransition } from './tiles';
import type { TransitionEffect } from './transition';

const COLS = 7, ROWS = 5, FLIP = 0.45;

export const checker: TransitionEffect = {
  type: 'checker',
  run(_old, el, t, dur) {
    const across = t.orient !== 'vert';
    const [start, end] = across ? [0.28, 0.86] : [0.1, 0.82];
    const lines = across ? COLS : ROWS;
    const cw = 100 / COLS, ch = 100 / ROWS;
    return tileTransition(el, dur, (u) => {
      const out: Rect[] = [];
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const order = across ? c + (r % 2) * 0.5 : r + (c % 2) * 0.5;
          const s = start + (order / (lines + 0.5)) * (end - start - FLIP);
          const q = smooth((u - s) / FLIP);
          if (q <= 0) continue;
          const x = c * cw, y = r * ch;
          out.push(across ? [x + (cw * (1 - q)) / 2, y, x + (cw * (1 + q)) / 2, y + ch] : [x, y + (ch * (1 - q)) / 2, x + cw, y + (ch * (1 + q)) / 2]);
        }
      }
      return out;
    });
  },
};
