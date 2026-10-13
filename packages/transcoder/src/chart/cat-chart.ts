/**
 * 分类轴图（柱、条、折线、面积，可以组合、带次坐标轴）的公共部分：算数值轴、留出坐标轴标签的空间、
 * 画网格和坐标轴标签，再把绘图区（CategoryFrame）交给每种类型画系列。
 */
import { css, type ColorContext } from '../model/color';
import { parseLine } from '../style/line';
import { n2 } from '../common/svg';
import { attr, child, type XEl } from '../io/xml';
import { axesOf, axId } from './axis';
import type { CategoryFrame } from './chart-type';
import { chartTypeOf } from './chart-types';
import { label, textStyle } from './draw';
import { catBand, catCenter, PAD, RIGHT_LABEL_PAD, SIDE_LABEL_PAD, sideAnchor, sideGap, topForLabel, valBand, valCenter, type TextWidth } from './layout';
import type { AxisMaker, Plot, Rect, TextStyle } from './model';
import { lineType } from './types/line-area';

export interface CatEnv { colors: ColorContext; part: string; baseText: TextStyle; makeAxis: AxisMaker; tw: TextWidth; w: number }

export function renderCategoryChart(plots: Plot[], plotArea: XEl | undefined, area: Rect, env: CatEnv, out: string[]): void {
  const { colors, baseText, makeAxis, tw, w } = env;
  let { left, top, right, bottom } = area;
  const { valAxes, catAxes } = axesOf(plotArea);
  const axisOf = (p: Plot) => valAxes.find((a) => p.axIds.includes(axId(a))) ?? valAxes[0];
  const catAx = catAxes.find((a) => plots[0].axIds.includes(axId(a))) ?? catAxes[0];
  const catStyle = textStyle(child(catAx, 'c:txPr'), colors, baseText);
  const horizontal = plots.some((p) => chartTypeOf(p.kind)?.horizontal?.(p) ?? false);
  const cats = plots[0].series[0]?.cats ?? [];
  const nCat = Math.max(1, ...plots.flatMap((p) => p.series.map((s) => s.vals.length)));

  // 数值范围（堆积按每个分类求和）
  const rangeOf = (ps: Plot[]): [number, number] => {
    let vmin = 0, vmax = 0;
    for (const p of ps) {
      if (p.grouping === 'percentStacked') { vmax = Math.max(vmax, 1); continue; }
      if (p.grouping === 'stacked') {
        for (let i = 0; i < nCat; i++) {
          let pos = 0, neg = 0;
          for (const s of p.series) { const v = s.vals[i] ?? 0; if (v >= 0) pos += v; else neg += v; }
          vmax = Math.max(vmax, pos); vmin = Math.min(vmin, neg);
        }
      } else {
        for (const s of p.series) for (const v of s.vals) if (v !== null) { vmax = Math.max(vmax, v); vmin = Math.min(vmin, v); }
      }
    }
    return [vmin, vmax];
  };
  // 主坐标轴和次坐标轴（组合图里某些系列画在右侧的次坐标轴上）
  const primaryAx = axisOf(plots[0]);
  const secondaryAx = valAxes.find((a) => a !== primaryAx && plots.some((p) => axisOf(p) === a));
  const onSecondary = (p: Plot) => !!secondaryAx && axisOf(p) === secondaryAx;
  const primPlots = plots.filter((p) => !onSecondary(p));
  const prim = makeAxis(primaryAx, ...rangeOf(primPlots), primPlots.some((p) => p.grouping === 'percentStacked'));
  const secPlots = plots.filter(onSecondary);
  const sec = secondaryAx ? makeAxis(secondaryAx, ...rangeOf(secPlots), secPlots.some((p) => p.grouping === 'percentStacked')) : undefined;
  const valStyle = prim.style;
  const tickLabels = prim.labels;
  const valDeleted = prim.deleted;
  const catDeleted = attr(child(catAx, 'c:delete'), 'val') === '1';

  // 留出坐标轴标签的空间（实测规律见 layout.ts）：左右两侧的标签从图表边 SIDE_LABEL_PAD 处排起
  const sideLeft = (labels: string[], s: number) => (left === PAD ? SIDE_LABEL_PAD : left) + Math.max(0, ...labels.map((t) => tw(t, s))) + sideGap(s);
  if (!horizontal) {
    if (!valDeleted) { left = sideLeft(tickLabels, valStyle.size); top = Math.max(top, topForLabel(valStyle.size)); }
    if (sec && !sec.deleted) right = (right === w - PAD ? w - SIDE_LABEL_PAD : right) - Math.max(0, ...sec.labels.map((t) => tw(t, sec.style.size))) - sideGap(sec.style.size);
    if (!catDeleted) bottom -= catBand(catStyle.size);
  } else {
    if (!catDeleted) left = sideLeft(cats, catStyle.size);
    if (!valDeleted) {
      bottom -= valBand(valStyle.size);
      right = Math.min(right, w - RIGHT_LABEL_PAD - tw(tickLabels[tickLabels.length - 1] ?? '', valStyle.size) / 2);
    }
  }
  // 分类标签落在坐标轴两端（面积图等 midCat）时，给首尾标签各留半个标签宽度
  const between = attr(child(primaryAx, 'c:crossBetween'), 'val') !== 'midCat';
  if (!between && !horizontal && !catDeleted && cats.length) {
    left = Math.max(left, PAD + tw(cats[0], catStyle.size) / 2 - 4);
    right = Math.min(right, w - PAD - tw(cats[cats.length - 1], catStyle.size) / 2 + 4);
  }
  const pw = Math.max(1, right - left), ph = Math.max(1, bottom - top);
  const band = (horizontal ? ph : pw) / (between ? nCat : Math.max(1, nCat - 1));
  const bandCenter = (i: number) => (between ? (i + 0.5) * band : i * band);
  const frame: CategoryFrame = {
    left, top, right, bottom, pw, ph, band, catCenter: bandCenter, nCat, horizontal,
    catPx: horizontal ? (d) => bottom - d : (d) => left + d,
    catSpan: horizontal ? (d, len) => [bottom - d - len, len] : (d, len) => [left + d, len],
    valPx: horizontal ? (f) => left + f * pw : (f) => bottom - f * ph,
  };

  // 网格线
  const gridLine = prim.grid;
  prim.ticks.forEach((t, i) => {
    const v = frame.valPx(prim.pos(t));
    if (!horizontal) {
      if (gridLine?.color) out.push(`<line x1="${n2(left)}" y1="${n2(v)}" x2="${n2(right)}" y2="${n2(v)}" stroke="${css(gridLine.color)}" stroke-width="${n2(gridLine.width)}"/>`);
      if (!valDeleted) out.push(label(tickLabels[i], left - sideAnchor(valStyle.size), v, valStyle, 'end'));
    } else {
      if (gridLine?.color) out.push(`<line x1="${n2(v)}" y1="${n2(top)}" x2="${n2(v)}" y2="${n2(bottom)}" stroke="${css(gridLine.color)}" stroke-width="${n2(gridLine.width)}"/>`);
      if (!valDeleted) out.push(label(tickLabels[i], v, bottom + valCenter(valStyle.size), valStyle));
    }
  });
  if (sec && !sec.deleted && !horizontal) {
    sec.ticks.forEach((t, i) => out.push(label(sec.labels[i], right + sideAnchor(sec.style.size), frame.valPx(sec.pos(t)), sec.style, 'start')));
  }

  // 分类轴标签
  const catLine = parseLine([child(child(catAx, 'c:spPr'), 'a:ln')], [colors], env.part);
  if (!catDeleted) {
    cats.forEach((c, i) => {
      const at = frame.catPx(bandCenter(i));
      if (!horizontal) out.push(label(c, at, bottom + catCenter(catStyle.size), catStyle));
      else out.push(label(c, left - sideAnchor(catStyle.size), at, catStyle, 'end'));
    });
  }

  // ---------------- 系列（数据标签最后画，盖在图形上面）
  const labelsOut: string[] = [];
  const zero = frame.valPx(prim.pos(Math.max(prim.lo, Math.min(prim.hi, 0))));
  for (const p of plots) {
    // 每个图按自己的坐标轴换算；不是分类轴图的类型按折线画
    const A = onSecondary(p) && sec ? sec : prim;
    const t = chartTypeOf(p.kind);
    (t?.renderOnAxes ? t : lineType).renderOnAxes!(p, frame, A, out, labelsOut);
  }

  // 分类轴线（画在系列上面）
  if (catLine?.color && !catDeleted) {
    if (!horizontal) out.push(`<line x1="${n2(left)}" y1="${n2(zero)}" x2="${n2(right)}" y2="${n2(zero)}" stroke="${css(catLine.color)}" stroke-width="${n2(catLine.width)}"/>`);
    else out.push(`<line x1="${n2(zero)}" y1="${n2(top)}" x2="${n2(zero)}" y2="${n2(bottom)}" stroke="${css(catLine.color)}" stroke-width="${n2(catLine.width)}"/>`);
  }
  out.push(...labelsOut);
}
