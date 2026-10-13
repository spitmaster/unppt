/**
 * 气泡图：散点图的点换成大小随数值变化的圆（坐标框架见 xy.ts）。实测规律：
 * 最大气泡的直径 = 绘图区短边 × 25% × 4.5s / (s + 3.5)（s 是气泡大小比例 / 100，8 种比例都吻合）；
 * 默认按面积比例（sizeRepresents="w" 时按直径）；三维气泡画成带高光的球。
 * 坐标轴范围和图表的像素大小无关（实测 36 组）：每个点向两边各留 最大直径比例 × √(大小/最大) × 数据跨度，
 * 不再加 5% 余量（这样吻合 111/144 个坐标轴端点，按像素换算只有 92/144）
 */
import { css, opacity, type Rgba } from '../../model/color';
import { n2 } from '../../common/svg';
import { cpart } from '../draw';
import { renderXY, type Range, type XYFrame } from '../xy';
import type { ChartType } from '../chart-type';
import type { Plot, SvgDefs } from '../model';

function sizer(p: Plot) {
  const max = Math.max(0, ...p.series.flatMap((s) => (s.sizes ?? []).map((v) => Math.abs(v ?? 0))));
  const sc = Math.max(0, p.bubbleScale) / 100;
  /** 最大气泡直径占绘图区短边的比例 */
  const frac = 0.25 * (4.5 * sc) / (sc + 3.5);
  /** 气泡直径相对最大气泡的比例；不画的返回 0 */
  const rel = (size: number | null | undefined) => (!max || size === null || size === undefined || size <= 0 ? 0 : p.sizeRepresents === 'w' ? size / max : Math.sqrt(size / max));
  return { frac, rel, px: (f: XYFrame, size: number | null | undefined) => frac * Math.min(f.pw, f.ph) * rel(size) };
}

/** 三维气泡的球面渐变（实测剖面）：左上 1/3 处高光（向白色提亮约 30%），右下边缘变暗约 25% */
function ballGradient(defs: SvgDefs, c: Rgba): string {
  const id = defs.id('bub');
  const mix = (k: number, t: number) => ({ r: Math.round(c.r + (t - c.r) * k), g: Math.round(c.g + (t - c.g) * k), b: Math.round(c.b + (t - c.b) * k), a: c.a });
  defs.add(`<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.5" fx="0.375" fy="0.375">`
    + `<stop offset="0" stop-color="${css(mix(0.3, 255))}"/><stop offset="0.3" stop-color="${css(mix(0.08, 255))}"/>`
    + `<stop offset="0.6" stop-color="${css(c)}"/><stop offset="0.85" stop-color="${css(mix(0.08, 0))}"/>`
    + `<stop offset="1" stop-color="${css(mix(0.28, 0))}"/></radialGradient>`);
  return `url(#${id})`;
}

export const bubbleType: ChartType = {
  kind: 'bubble',
  tags: ['bubbleChart'],
  layout: 'standalone',
  hasAxes: true,
  legendByCategory: false,
  seriesRules: () => ({ xy: true, defaultLine: false, marker: () => false }),
  legendKey: (_p, s) => ({ color: s.fill, line: false, dot: true }),
  render(p, a, ctx) {
    const size = sizer(p);
    return renderXY(p, ctx, a, {
      extend(range): Range {
        // 数据跨度（不含 0）
        let dx0 = Infinity, dx1 = -Infinity, dy0 = Infinity, dy1 = -Infinity;
        for (const s of p.series) {
          s.vals.forEach((v, i) => {
            const x = s.xs?.[i];
            if (v === null || x === null || x === undefined) return;
            dx0 = Math.min(dx0, x); dx1 = Math.max(dx1, x); dy0 = Math.min(dy0, v); dy1 = Math.max(dy1, v);
          });
        }
        const r: Range = { ...range, margin: 0 };
        for (const s of p.series) {
          s.vals.forEach((v, i) => {
            const x = s.xs?.[i];
            if (v === null || x === null || x === undefined) return;
            const k = size.frac * size.rel(s.sizes?.[i]);
            const rx = k * (dx1 - dx0), ry = k * (dy1 - dy0);
            r.x0 = Math.min(r.x0, x - rx); r.x1 = Math.max(r.x1, x + rx);
            r.y0 = Math.min(r.y0, v - ry); r.y1 = Math.max(r.y1, v + ry);
          });
        }
        return r;
      },
      series(s, pts, f, out) {
        if (!s.fill) return;
        const paint = s.bubble3D && ctx.defs ? ballGradient(ctx.defs, s.fill) : css(s.fill);
        const op = opacity(s.fill);
        const alpha = op ? ` fill-opacity="${op}"` : '';
        for (const q of pts) {
          const d = size.px(f, s.sizes?.[q.i]);
          if (d > 0) out.push(cpart(`${s.index}x${q.i}`, `<circle cx="${n2(q.x)}" cy="${n2(q.y)}" r="${n2(d / 2)}" fill="${paint}"${alpha}/>`));
        }
      },
    });
  },
};
