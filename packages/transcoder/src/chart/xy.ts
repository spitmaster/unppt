/**
 * 横轴、纵轴都是数值轴的图（散点、气泡）的公共部分：按数据范围算两根轴、留出坐标轴标签的空间、
 * 画网格和轴线，再把每个数据点换成像素位置交给具体类型画。
 */
import { attr, child, type XEl } from '../io/xml';
import { css } from '../model/color';
import { n2 } from '../common/svg';
import { cpart, label } from './draw';
import { errRanges, errSvg } from './error-bars';
import { extraValues, trendlines } from './extras';
import { PAD, RIGHT_LABEL_PAD, SIDE_LABEL_PAD, sideAnchor, sideGap, topForLabel, valBand, valCenter, type TextWidth } from './layout';
import type { AxisInfo, AxisMaker, Plot, Rect, Series } from './model';

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

export function renderXY(p: Plot, valAxes: XEl[], makeAxis: AxisMaker, tw: TextWidth, w: number, area: Rect, marks: XYMarks): string {
  const xAx = valAxes.find((a) => { const pos = attr(child(a, 'c:axPos'), 'val'); return pos === 'b' || pos === 't'; }) ?? valAxes[0];
  const yAx = valAxes.find((a) => a !== xAx) ?? valAxes[1];
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
      right = Math.min(right, w - RIGHT_LABEL_PAD - tw(X.labels[X.labels.length - 1] ?? '', X.style.size) / 2);
    }
    return { left, top, right, bottom, pw: Math.max(1, right - left), ph: Math.max(1, bottom - top), X, Y };
  };
  // 自动刻度的疏密取决于轴长（axis.ts）：先按默认刻度排一遍得到轴长，再按轴长选刻度重排
  const r0 = marks.extend ? marks.extend(range) : range;
  const f0 = layout(r0);
  const f = layout(r0, { x: f0.pw, y: f0.ph });
  const { left, top, right, bottom, pw, ph, X, Y } = f;
  const out: string[] = [];
  Y.ticks.forEach((t, i) => {
    const y = bottom - Y.pos(t) * ph;
    if (Y.grid?.color) out.push(`<line x1="${n2(left)}" y1="${n2(y)}" x2="${n2(right)}" y2="${n2(y)}" stroke="${css(Y.grid.color)}" stroke-width="${n2(Y.grid.width)}"/>`);
    if (!Y.deleted) out.push(label(Y.labels[i], left - sideAnchor(Y.style.size), y, Y.style, 'end'));
  });
  X.ticks.forEach((t, i) => {
    const x = left + X.pos(t) * pw;
    if (X.grid?.color) out.push(`<line x1="${n2(x)}" y1="${n2(top)}" x2="${n2(x)}" y2="${n2(bottom)}" stroke="${css(X.grid.color)}" stroke-width="${n2(X.grid.width)}"/>`);
    if (!X.deleted) out.push(label(X.labels[i], x, bottom + valCenter(X.style.size), X.style));
  });
  // 坐标轴线：横轴画在纵轴 0 的位置，纵轴画在横轴 0 的位置
  const x0f = X.pos(Math.max(X.lo, Math.min(X.hi, 0))), y0f = Y.pos(Math.max(Y.lo, Math.min(Y.hi, 0)));
  if (X.axisLine?.color && !X.deleted) out.push(`<line x1="${n2(left)}" y1="${n2(bottom - y0f * ph)}" x2="${n2(right)}" y2="${n2(bottom - y0f * ph)}" stroke="${css(X.axisLine.color)}" stroke-width="${n2(X.axisLine.width)}"/>`);
  if (Y.axisLine?.color && !Y.deleted) out.push(`<line x1="${n2(left + x0f * pw)}" y1="${n2(top)}" x2="${n2(left + x0f * pw)}" y2="${n2(bottom)}" stroke="${css(Y.axisLine.color)}" stroke-width="${n2(Y.axisLine.width)}"/>`);
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
