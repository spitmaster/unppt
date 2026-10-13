/**
 * 横轴、纵轴都是数值轴的图（散点、气泡）的公共部分：按数据范围算两根轴、留出坐标轴标签的空间、
 * 画网格和轴线，再把每个数据点换成像素位置交给具体类型画。
 */
import { attr, child, type XEl } from '../io/xml';
import { cpart, label } from './draw';
import { errRanges, errSvg } from './error-bars';
import { extraValues, trendlines } from './extras';
import { PAD, SIDE_LABEL_PAD, sideAnchor, sideGap, topForLabel, valBand, valCenter } from './layout';
import { axesOf } from './axis';
import { readAxisTitle, renderAxisTitles, reserveAxisTitles } from './axis-title';
import type { AxisInfo, ChartContext, Plot, Rect, Series } from './model';
import { axisLine } from './sides';
import { NO_GRID } from './pixel-grid';

export interface XYPoint { x: number; y: number; i: number }
export interface XYFrame { left: number; top: number; right: number; bottom: number; pw: number; ph: number; X: AxisInfo; Y: AxisInfo }
/** 数据范围；margin 是坐标轴最大值上方的余量（不写是 5%） */
export interface Range { x0: number; x1: number; y0: number; y1: number; margin?: number }

export interface XYMarks {
  /** 数据范围要不要按图形的大小扩大（气泡不能被裁掉） */
  extend?(range: Range): Range;
  /** 画一个系列（pts 是像素位置和数据序号） */
  series(s: Series, pts: XYPoint[], f: XYFrame, out: string[]): void;
}

export function renderXY(p: Plot, ctx: ChartContext, area0: Rect, marks: XYMarks): string {
  const { makeAxis, width: tw } = ctx;
  const valAxes: XEl[] = axesOf(ctx.plotArea).valAxes;
  const xAx = valAxes.find((a) => { const pos = attr(child(a, 'c:axPos'), 'val'); return pos === 'b' || pos === 't'; }) ?? valAxes[0];
  const yAx = valAxes.find((a) => a !== xAx) ?? valAxes[1];
  // 坐标轴标题：横轴的在下面、纵轴的在左边（见 axis-title.ts）
  const title = (ax: XEl | undefined) => readAxisTitle(ax, ctx.colors, ctx.baseText, ctx.zh ?? true);
  const titles = { left: title(yAx), bottom: title(xAx) };
  const area = reserveAxisTitles(area0, titles);
  let range: Range = { x0: 0, x1: 0, y0: 0, y1: 0 };
  for (const s of p.series) {
    s.vals.forEach((v, i) => {
      const x = s.xs?.[i];
      if (v === null || x === null || x === undefined) return;
      range = { x0: Math.min(range.x0, x), x1: Math.max(range.x1, x), y0: Math.min(range.y0, v), y1: Math.max(range.y1, v) };
    });
    // 趋势线、误差线也要放得下
    for (const v of extraValues(s, (i) => s.xs?.[i])) range = { ...range, y0: Math.min(range.y0, v), y1: Math.max(range.y1, v) };
  }
  const layout = (r: Range, len?: { x: number; y: number }): XYFrame => {
    const X = makeAxis(xAx, r.x0, r.x1, { margin: r.margin, length: len?.x, horizontal: true });
    const Y = makeAxis(yAx, r.y0, r.y1, { margin: r.margin, length: len?.y });
    let { left, top, right, bottom } = area;
    // 留出坐标轴标签的空间（和分类轴图同一套实测规律，见 layout.ts）
    if (!Y.deleted) {
      left = (left === PAD ? SIDE_LABEL_PAD : left) + Math.max(0, ...Y.labels.map((t) => tw(t, Y.style.size))) + sideGap(Y.style.size);
      top = Math.max(top, topForLabel(Y.style.size));
    }
    if (!X.deleted) {
      bottom -= valBand(X.style.size);
      right = Math.min(right, area.right - tw(X.labels[X.labels.length - 1] ?? '', X.style.size) / 2);
    }
    return { left, top, right, bottom, pw: Math.max(1, right - left), ph: Math.max(1, bottom - top), X, Y };
  };
  // 自动刻度的疏密取决于轴长（axis.ts）：先按默认刻度排一遍得到轴长，再按轴长选刻度重排
  const r0 = marks.extend ? marks.extend(range) : range;
  const f0 = layout(r0);
  // 网格线和坐标轴线按像素中心的规则对齐整像素（pixel-grid.ts）
  const g = ctx.snap ?? NO_GRID;
  const f = layout(r0, { x: f0.pw, y: f0.ph });
  const { left, top, right, bottom, pw, ph, X, Y } = f;
  const box: Rect = { left, top, right, bottom };
  const out: string[] = [];
  if (ctx.plotBg) out.push(ctx.plotBg(box));
  renderAxisTitles(titles, box, area0, out);
  Y.ticks.forEach((t, i) => {
    const y = bottom - Y.pos(t) * ph;
    if (Y.grid?.color) out.push(axisLine('h', y, box, Y.grid, g));
    if (!Y.deleted) out.push(label(Y.labels[i], left - sideAnchor(Y.style.size), y, Y.style, 'end'));
  });
  X.ticks.forEach((t, i) => {
    const x = left + X.pos(t) * pw;
    if (X.grid?.color) out.push(axisLine('v', x, box, X.grid, g));
    if (!X.deleted) out.push(label(X.labels[i], x, bottom + valCenter(X.style.size), X.style));
  });
  // 坐标轴线：横轴画在纵轴 0 的位置，纵轴画在横轴 0 的位置
  const x0f = X.pos(Math.max(X.lo, Math.min(X.hi, 0))), y0f = Y.pos(Math.max(Y.lo, Math.min(Y.hi, 0)));
  if (X.axisLine?.color && !X.deleted) out.push(axisLine('h', bottom - y0f * ph, box, X.axisLine, g));
  if (Y.axisLine?.color && !Y.deleted) out.push(axisLine('v', left + x0f * pw, box, Y.axisLine, g));
  for (const s of p.series) {
    const pts: XYPoint[] = [];
    s.vals.forEach((v, i) => {
      const x = s.xs?.[i];
      if (v === null || x === null || x === undefined) return;
      pts.push({ x: left + X.pos(x) * pw, y: bottom - Y.pos(v) * ph, i });
    });
    if (pts.length) marks.series(s, pts, f, out);
    out.push(...trendlines(s, (i) => s.xs?.[i], (x, y) => [left + X.pos(x) * pw, bottom - Y.pos(y) * ph]));
    for (const e of s.errBars) {
      // Y 方向的误差线竖着画在点上，X 方向的横着画
      const xs = s.xs ?? [];
      const ranges = errRanges(e, e.dir === 'x' ? xs.map((x, i) => (s.vals[i] === null ? null : x ?? null)) : s.vals);
      ranges.forEach((r, i) => {
        const x = xs[i], v = s.vals[i];
        if (!r || x === null || x === undefined || v === null) return;
        out.push(cpart(`${s.index}x${i}e`, e.dir === 'x'
          ? errSvg(e, bottom - Y.pos(v) * ph, left + X.pos(r[0]) * pw, left + X.pos(r[1]) * pw, false)
          : errSvg(e, left + X.pos(x) * pw, bottom - Y.pos(r[0]) * ph, bottom - Y.pos(r[1]) * ph, true)));
      });
    }
  }
  return out.join('');
}
