/** 系列的附加部分（趋势线、误差线）：自动刻度要包含它们；趋势线的画法（分类轴图和散点图共用） */
import { cpart } from './draw';
import { errRanges } from './error-bars';
import type { Series } from './model';
import { trendPoints, trendSvg } from './trendline';

/** 这个系列有数据的点：x（散点图是 X 值，分类轴图是分类序号 1、2、3……）和 y */
function dataPoints(s: Series, xOf: (i: number) => number | null | undefined): { xs: number[]; ys: number[] } {
  const xs: number[] = [], ys: number[] = [];
  s.vals.forEach((v, i) => {
    const x = xOf(i);
    if (v !== null && x !== null && x !== undefined) { xs.push(x); ys.push(v); }
  });
  return { xs, ys };
}

/** 趋势线和 Y 方向误差线占到的数值（加进自动刻度的范围） */
export function extraValues(s: Series, xOf: (i: number) => number | null | undefined): number[] {
  const out: number[] = [];
  if (s.trendlines.length) {
    const { xs, ys } = dataPoints(s, xOf);
    for (const t of s.trendlines) for (const q of trendPoints(t, xs, ys)) out.push(q[1]);
  }
  for (const e of s.errBars) if (e.dir === 'y') for (const r of errRanges(e, s.vals)) if (r) out.push(r[0], r[1]);
  return out;
}

/** 画系列的趋势线（toPx 把数据坐标换成像素）；部件编号"系列t序号"，按系列动画时和系列一起出现 */
export function trendlines(s: Series, xOf: (i: number) => number | null | undefined, toPx: (x: number, y: number) => [number, number]): string[] {
  if (!s.trendlines.length) return [];
  const { xs, ys } = dataPoints(s, xOf);
  return s.trendlines.map((t, k) => cpart(`${s.index}t${k}`, trendSvg(t, trendPoints(t, xs, ys).map((q) => toPx(q[0], q[1])))));
}
