/**
 * 复合饼图、复合条饼图：主饼里后面几个点合成一块"其他"，右边用第二个饼（或一根堆积条）展开，两条线连起来。
 * PowerPoint 实测（charts-ofpie 导出图、COM 读 9 种点数的默认拆分）：
 *   - 默认（auto）按位置拆，右边放最后 round((点数 + 1) / 3) 个点；
 *   - 主饼半径 r：2r + 间距 + 右图宽 = 绘图区宽（高度不够时按 0.965 × 高，和饼图一样）；右边的饼直径 = 第二绘图区大小% × 2r，
 *     条宽 = 大小% × r、条高 = 大小% × 2r；间距 = 0.7 × 间隙宽度% × 右图宽；整体在绘图区里居中；
 *   - "其他"块的中心朝右（0°），主饼从它的一半处顺时针排，右边的饼也从同一角度开始，条从上往下排；
 *   - 连接线：主饼"其他"块两个外角到右边饼的切线（条图连到条的上下角）
 */
import { css, type ColorContext, type Rgba } from '../../model/color';
import { n2 } from '../../common/svg';
import { accentColor, cpart } from '../draw';
import type { Plot, Rect } from '../model';
import type { ChartType } from '../chart-type';
import { slicePath } from './pie';

/** 哪些点（原来的序号）放到右边 */
function splitIndices(p: Plot, vals: number[]): Set<number> {
  const o = p.ofPie!;
  const n = vals.length;
  const total = vals.reduce((a, b) => a + b, 0) || 1;
  const pick = (f: (v: number, i: number) => boolean) => new Set(vals.map((_v, i) => i).filter((i) => f(vals[i], i)));
  if (o.splitType === 'val') return pick((v) => v < o.splitPos);
  if (o.splitType === 'percent') return pick((v) => (v / total) * 100 < o.splitPos);
  if (o.splitType === 'cust') return new Set(o.custom);
  const k = o.splitType === 'pos' ? Math.round(o.splitPos) : Math.round((n + 1) / 3);
  return pick((_v, i) => i >= n - Math.max(0, Math.min(n - 1, k)));
}

function renderOfPie(p: Plot, a: Rect, colors: ColorContext): string {
  const s = p.series[0];
  const o = p.ofPie;
  if (!s || !o) return '';
  const vals = s.vals.map((v) => Math.max(0, v ?? 0));
  const second = splitIndices(p, vals);
  const firstIdx = vals.map((_v, i) => i).filter((i) => !second.has(i));
  const secondIdx = vals.map((_v, i) => i).filter((i) => second.has(i));
  const other = secondIdx.reduce((t, i) => t + vals[i], 0);
  const total = vals.reduce((t, v) => t + v, 0);
  if (!total) return '';
  const W = a.right - a.left, H = a.bottom - a.top;
  const sz = o.second / 100, g = o.gap / 100;
  const bar = o.type === 'bar';
  // 右图宽（相对主饼半径）、间距
  const rightW = bar ? sz : 2 * sz, gapK = 0.7 * g * rightW;
  const r = Math.min(W / (2 + gapK + rightW), (H * 0.965) / 2);
  const x0 = a.left + (W - r * (2 + gapK + rightW)) / 2, cy = (a.top + a.bottom) / 2;
  const cx = x0 + r;
  const colorOf = (i: number): Rgba => s.pointFills.get(i) ?? accentColor(i, colors);
  const out: string[] = [];
  const slice = (key: string, x: number, r0: number, a1: number, a2: number, full: boolean, color: Rgba) =>
    out.push(cpart(key, `<path d="${slicePath(x, cy, r0, 0, a1, a2, full)}" fill="${css(color)}" stroke="#fff" stroke-width="1.5"/>`));
  // 主饼："其他"块中心朝右
  const half = (other / total) * Math.PI;
  let ang = half;
  for (const i of firstIdx) {
    if (!vals[i]) continue;
    const a2 = ang + (vals[i] / total) * Math.PI * 2;
    slice(`${s.index}x${i}`, cx, r, ang, a2, vals[i] === total, colorOf(i));
    ang = a2;
  }
  if (other) slice(`${s.index}x${vals.length}`, cx, r, -half, half, other === total, s.pointFills.get(vals.length) ?? accentColor(vals.length, colors));
  // 右边
  const rx = x0 + r * (2 + gapK);
  const top = [cx + r * Math.cos(-half), cy + r * Math.sin(-half)], bot = [cx + r * Math.cos(half), cy + r * Math.sin(half)];
  const lines: string[] = [];
  if (bar) {
    const bw = sz * r, bh = 2 * sz * r, by = cy - bh / 2;
    let y = by;
    for (const i of secondIdx) {
      const hh = other ? (vals[i] / other) * bh : 0;
      out.push(cpart(`${s.index}x${i}`, `<rect x="${n2(rx)}" y="${n2(y)}" width="${n2(bw)}" height="${n2(hh)}" fill="${css(colorOf(i))}" stroke="#fff" stroke-width="1.5"/>`));
      y += hh;
    }
    lines.push(`M${n2(top[0])} ${n2(top[1])}L${n2(rx)} ${n2(by)}`, `M${n2(bot[0])} ${n2(bot[1])}L${n2(rx)} ${n2(by + bh)}`);
  } else {
    const r2 = sz * r, c2 = rx + r2;
    let b = half;
    for (const i of secondIdx) {
      if (!vals[i]) continue;
      const b2 = b + (vals[i] / (other || 1)) * Math.PI * 2;
      slice(`${s.index}x${i}`, c2, r2, b, b2, vals[i] === other, colorOf(i));
      b = b2;
    }
    // 外角到右边饼的切线
    const tangent = (pt: number[], upper: boolean) => {
      const dx = pt[0] - c2, dy = pt[1] - cy, d = Math.hypot(dx, dy);
      const base = Math.atan2(dy, dx), off = Math.acos(Math.min(1, r2 / d));
      const t = base + (upper ? off : -off);
      return [c2 + r2 * Math.cos(t), cy + r2 * Math.sin(t)];
    };
    const t1 = tangent(top, true), t2 = tangent(bot, false);
    lines.push(`M${n2(top[0])} ${n2(top[1])}L${n2(t1[0])} ${n2(t1[1])}`, `M${n2(bot[0])} ${n2(bot[1])}L${n2(t2[0])} ${n2(t2[1])}`);
  }
  const lc = o.lines?.color ?? { r: 166, g: 166, b: 166, a: 1 };
  out.push(`<path d="${lines.join('')}" fill="none" stroke="${css(lc)}" stroke-width="${n2(o.lines?.width ?? 1)}"/>`);
  return out.join('');
}

export const ofPieType: ChartType = {
  kind: 'ofPie',
  tags: ['ofPieChart'],
  layout: 'standalone',
  hasAxes: false,
  legendByCategory: true,
  seriesRules: () => ({ xy: false, defaultLine: false, marker: () => false }),
  legendKey: (_p, s) => ({ color: s.fill, line: false }),
  render: (p, a, ctx) => renderOfPie(p, a, ctx.colors),
};
