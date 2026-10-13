/**
 * 趋势线：按系列的数据拟合（线性、指数、对数、多项式、乘幂、移动平均），画成一条线，图例里单独一项。
 * 散点图的 x 是 X 值，分类轴图的 x 是分类序号 1、2、3……（和 Excel 一样）。
 */
import { attr, child, children, findAll, numAttr, type XEl } from '../io/xml';
import { css, type ColorContext, type Rgba } from '../model/color';
import { parseLine, type Line } from '../style/line';
import type { Trendline } from './model';
import { n2 } from '../common/svg';

/** 默认名称（PowerPoint 实测，中文界面 / 英文界面）；乘幂在中文界面后面没有空格 */
const NAMES: Record<string, [string, string]> = {
  linear: ['线性 ', 'Linear '], exp: ['指数 ', 'Expon. '], log: ['对数 ', 'Log. '], poly: ['多项式 ', 'Poly. '], power: ['乘幂', 'Power '],
};

export function readTrendlines(ser: XEl, serName: string, color: Rgba | undefined, colors: ColorContext, part: string, zh: boolean): Trendline[] {
  return children(ser, 'c:trendline').map((t) => {
    const type = attr(child(t, 'c:trendlineType'), 'val') ?? 'linear';
    const period = numAttr(child(t, 'c:period'), 'val') ?? 2;
    const own = findAll(child(t, 'c:name'), 'c:v')[0]?.text ?? child(t, 'c:name')?.text;
    const name = own || (type === 'movingAvg'
      ? (zh ? `${period}周期 移动平均 (${serName})` : `${period} per. Mov. Avg. (${serName})`)
      : `${(NAMES[type] ?? NAMES.linear)[zh ? 0 : 1]}(${serName})`);
    // 没写线条时：系列颜色、1.5 磅圆点虚线（新版 Office 的默认样式）
    const line = parseLine([child(child(t, 'c:spPr'), 'a:ln')], [colors], part) ?? { color, width: 2, dash: '2 2', cap: 'round', join: 'round' };
    return {
      type, order: numAttr(child(t, 'c:order'), 'val') ?? 2, period,
      forward: numAttr(child(t, 'c:forward'), 'val') ?? 0, backward: numAttr(child(t, 'c:backward'), 'val') ?? 0,
      intercept: numAttr(child(t, 'c:intercept'), 'val'), line, name,
    };
  });
}

/** 最小二乘求多项式系数（c0 + c1 x + … + cn x^n）；fixed0 给了时常数项固定 */
function polyFit(xs: number[], ys: number[], n: number, fixed0?: number): number[] | undefined {
  const k0 = fixed0 === undefined ? 0 : 1;
  const m = n + 1 - k0;
  if (xs.length < m) return undefined;
  const A = Array.from({ length: m }, () => new Array(m + 1).fill(0));
  xs.forEach((x, i) => {
    const y = ys[i] - (fixed0 ?? 0);
    for (let r = 0; r < m; r++) {
      for (let c = 0; c < m; c++) A[r][c] += Math.pow(x, r + k0) * Math.pow(x, c + k0);
      A[r][m] += Math.pow(x, r + k0) * y;
    }
  });
  // 高斯消元
  for (let c = 0; c < m; c++) {
    let p = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return undefined;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < m; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k <= m; k++) A[r][k] -= f * A[c][k];
    }
  }
  const coef = A.map((row, i) => row[m] / row[i]);
  return fixed0 === undefined ? coef : [fixed0, ...coef];
}

const polyAt = (c: number[], x: number) => c.reduce((a, ci, i) => a + ci * Math.pow(x, i), 0);

/** 拟合出 y = f(x)；数据不够或者取对数遇到非正数时返回 undefined */
function fitCurve(t: Trendline, xs: number[], ys: number[]): ((x: number) => number) | undefined {
  const ok = (keep: (x: number, y: number) => boolean) => {
    const idx = xs.map((_x, i) => i).filter((i) => keep(xs[i], ys[i]));
    return [idx.map((i) => xs[i]), idx.map((i) => ys[i])] as const;
  };
  if (t.type === 'exp') {
    const [x, y] = ok((_x, v) => v > 0);
    const c = polyFit(x, y.map(Math.log), 1, t.intercept && t.intercept > 0 ? Math.log(t.intercept) : undefined);
    return c && ((v) => Math.exp(polyAt(c, v)));
  }
  if (t.type === 'log') {
    const [x, y] = ok((v) => v > 0);
    const c = polyFit(x.map(Math.log), y, 1);
    return c && ((v) => polyAt(c, Math.log(v)));
  }
  if (t.type === 'power') {
    const [x, y] = ok((u, v) => u > 0 && v > 0);
    const c = polyFit(x.map(Math.log), y.map(Math.log), 1);
    return c && ((v) => Math.exp(polyAt(c, Math.log(v))));
  }
  const c = polyFit(xs, ys, t.type === 'poly' ? Math.max(2, Math.min(6, t.order)) : 1, t.intercept);
  return c && ((v) => polyAt(c, v));
}

/** 趋势线上的点（数据坐标）：曲线按 80 段采样，移动平均是逐点的平均 */
export function trendPoints(t: Trendline, xs: number[], ys: number[]): [number, number][] {
  if (t.type === 'movingAvg') {
    const p = Math.max(2, t.period);
    const out: [number, number][] = [];
    for (let i = p - 1; i < ys.length; i++) out.push([xs[i], ys.slice(i - p + 1, i + 1).reduce((a, b) => a + b, 0) / p]);
    return out;
  }
  const f = fitCurve(t, xs, ys);
  if (!f || !xs.length) return [];
  let x0 = Math.min(...xs) - t.backward, x1 = Math.max(...xs) + t.forward;
  if (t.type === 'log' || t.type === 'power') x0 = Math.max(x0, 1e-9);
  const n = t.type === 'linear' ? 1 : 80;
  const out: [number, number][] = [];
  for (let k = 0; k <= n; k++) {
    const x = x0 + ((x1 - x0) * k) / n;
    const y = f(x);
    if (isFinite(y)) out.push([x, y]);
  }
  return out;
}

/** 画成 SVG 折线（pts 已经换成像素） */
export function trendSvg(t: Trendline, pts: [number, number][]): string {
  const { line } = t;
  if (pts.length < 2 || !line.color) return '';
  const d = `M${pts.map((q) => `${n2(q[0])} ${n2(q[1])}`).join('L')}`;
  return `<path d="${d}" fill="none" stroke="${css(line.color)}" stroke-width="${n2(line.width)}"${dashAttr(line)} stroke-linecap="${line.cap}"/>`;
}

/** 圆头虚线：PowerPoint 的短划长度包含圆头，SVG 的圆头画在短划外面，所以短划减去、间隔加上一个线宽（否则圆点虚线连成实线） */
export function dashAttr(line: Line): string {
  if (!line.dash) return '';
  if (line.cap !== 'round') return ` stroke-dasharray="${line.dash}"`;
  const v = line.dash.split(' ').map(Number).map((x, i) => (i % 2 === 0 ? Math.max(0.01, x - line.width) : x + line.width));
  return ` stroke-dasharray="${v.map(n2).join(' ')}"`;
}
