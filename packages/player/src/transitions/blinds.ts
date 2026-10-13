/**
 * 百叶窗：横向 14 条（纵向按宽高比约 18 条）叶片同时翻到新页
 * （PowerPoint 是 3D 翻转，这里画成从叶片中线展开，露出比例按实测的余弦曲线）
 */
import { aspectOf } from './conic';
import { cosine } from './soft-edge';
import type { Rect } from './tiles';
import { tileTransition } from './tiles';
import type { TransitionEffect } from './transition';


export const blinds: TransitionEffect = {
  type: 'blinds',
  run(_old, el, t, dur) {
    const vert = t.orient === 'vert';
    const n = vert ? Math.max(4, Math.round(14 * aspectOf(el) * 0.74)) : 14;
    const [start, end] = vert ? [0.14, 0.68] : [0.18, 0.72];
    const size = 100 / n;
    return tileTransition(el, dur, (u) => {
      const q = cosine((u - start) / (end - start));
      if (q <= 0) return [];
      const out: Rect[] = [];
      for (let i = 0; i < n; i++) {
        const a = i * size + (size * (1 - q)) / 2, b = i * size + (size * (1 + q)) / 2;
        out.push(vert ? [a, 0, b, 100] : [0, a, 100, b]);
      }
      return out;
    });
  },
};
