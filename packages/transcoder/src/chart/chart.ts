/**
 * 图表：用 chart XML 里缓存的数据（numCache / strCache）直接画成 SVG，不需要 Excel。
 * 这里只负责公共部分：背景、标题、图例、绘图区布局、分类轴和数值轴（含次坐标轴）；
 * 每种图表怎么画由 ChartType 决定（chart-type.ts，注册在 chart-types.ts）。
 * 布局按 PowerPoint 默认的自动布局近似实现。
 */
import { css, type ColorContext, type Rgba } from '../model/color';
import { findFillEl, parseFill } from '../style/fill';
import { parseLine } from '../style/line';
import type { Theme } from '../model/model';
import { n2 } from '../common/svg';
import { attr, child, findAll, numAttr, path, type XEl } from '../io/xml';
import { axesOf, axId, axisMaker } from './axis';
import type { CategoryFrame } from './chart-type';
import { chartTypeOf } from './chart-types';
import { accentColor, label, legendKey, textStyle, textWidth } from './draw';
import { catBand, catCenter, legendBand, legendCenter, PAD, RIGHT_LABEL_PAD, SIDE_LABEL_PAD, sideAnchor, sideGap, topForLabel, valBand, valCenter, type TextWidth } from './layout';
import type { ChartContext, Plot, Series, TextStyle } from './model';
import { readPlots } from './read';
import { lineType } from './types/line-area';

export interface ChartEnv {
  colors: ColorContext;
  theme: Theme;
  part: string;
  warn(msg: string): void;
  /** 量文字宽度（有字体文件时用真实字宽）；不给时估算 */
  measure?: TextWidth;
}

export function renderChart(space: XEl | undefined, w: number, h: number, env: ChartEnv): string {
  if (!space) return '';
  const chart = child(space, 'c:chart');
  const plotArea = child(chart, 'c:plotArea');
  const { colors, theme } = env;
  const tw = env.measure ?? textWidth;
  const out: string[] = [];

  // 整个图表区的背景和边框
  const csSpPr = child(space, 'c:spPr');
  const bgFill = parseFill(findFillEl(csSpPr), colors, env.part);
  const bgLine = parseLine([child(csSpPr, 'a:ln')], [colors], env.part);
  if (bgFill && bgFill.kind === 'solid') out.push(`<rect width="${n2(w)}" height="${n2(h)}" fill="${css(bgFill.color)}"/>`);
  if (bgLine?.color) out.push(`<rect width="${n2(w)}" height="${n2(h)}" fill="none" stroke="${css(bgLine.color)}" stroke-width="${n2(bgLine.width)}"/>`);

  const baseText: TextStyle = textStyle(child(space, 'c:txPr'), colors, {
    size: 10 * 96 / 72, color: { r: 89, g: 89, b: 89, a: 1 }, bold: false, font: theme.minorLatin || 'Calibri',
  });

  const plots: Plot[] = readPlots(plotArea, colors, env.part, baseText, env.warn);
  if (!plots.length) return out.join('');
  const type0 = chartTypeOf(plots[0].kind)!;

  // ---------------- 标题
  // 实测：图表区四周留白约 11 磅
  let top = PAD, bottom = h - PAD, left = PAD, right = w - PAD;
  const titleEl = child(chart, 'c:title');
  const autoDeleted = attr(child(chart, 'c:autoTitleDeleted'), 'val') === '1';
  let titleText = '';
  if (titleEl) {
    titleText = findAll(child(titleEl, 'c:tx'), 'a:t').map((t) => t.text).join('');
    if (!titleText) titleText = plots.length === 1 && plots[0].series.length === 1 ? plots[0].series[0].name : '图表标题';
  } else if (!autoDeleted && plots.length === 1 && plots[0].series.length === 1) {
    titleText = plots[0].series[0].name;
  }
  if (titleText) {
    // 没写字号时：新版 Office 图表标题和其它文字的默认字号比例是 18.62 : 11.97
    const refSize = textStyle(child(child(chart, 'c:legend'), 'c:txPr'), colors, baseText).size;
    const ts = textStyle(child(titleEl, 'c:txPr'), colors, { ...baseText, size: refSize * 1862 / 1197 });
    const rich = path(titleEl, 'c:tx', 'c:rich');
    const rr = rich ? findAll(rich, 'a:rPr')[0] ?? findAll(rich, 'a:defRPr')[0] : undefined;
    const tst: TextStyle = rr ? { ...ts, size: numAttr(rr, 'sz') ? numAttr(rr, 'sz')! / 100 * 96 / 72 : ts.size } : ts;
    out.push(label(titleText, w / 2, top + tst.size * 0.6, tst));
    // 实测：带坐标轴的图标题下方多留约 10 像素，饼图不多留
    top += tst.size * 1.2 + (type0.hasAxes ? 16 : 6);
  }

  // ---------------- 图例
  const legend = child(chart, 'c:legend');
  const legendPos = attr(child(legend, 'c:legendPos'), 'val') ?? 'r';
  const legendText = textStyle(child(legend, 'c:txPr'), colors, baseText);
  if (legend) {
    const entries: { name: string; color: Rgba; line: boolean; marker: boolean; series?: Series }[] = [];
    if (type0.legendByCategory || (plots[0].varyColors && plots[0].series.length === 1)) {
      const s = plots[0].series[0];
      s?.cats.forEach((c, i) => entries.push({ name: c, color: s.pointFills.get(i) ?? accentColor(i, colors), line: false, marker: false }));
    } else {
      for (const p of plots) {
        const t = chartTypeOf(p.kind)!;
        for (const s of p.series) {
          const k = t.legendKey(p, s);
          entries.push({ name: s.name, color: k.color ?? accentColor(0, colors), line: k.line, marker: s.marker, series: s });
        }
      }
      if (type0.legendReversed?.(plots[0])) entries.reverse();
    }
    const ks = legendText.size * 0.6;
    const itemW = entries.map((e) => (e.line ? ks * 3 : ks) + 4 + tw(e.name, legendText.size) + 10);
    if (legendPos === 'b' || legendPos === 't') {
      const total = itemW.reduce((a, b) => a + b, 0);
      let x = (w - total) / 2;
      const y = legendPos === 'b' ? bottom - legendCenter(legendText.size) : top + legendText.size * 0.6;
      entries.forEach((e, i) => {
        out.push(legendKey(e, x, y, ks));
        out.push(label(e.name, x + (e.line ? ks * 3 : ks) + 4, y, legendText, 'start'));
        x += itemW[i];
      });
      if (legendPos === 'b') bottom -= legendBand(legendText.size);
      else top += legendText.size * 1.2 + 8;
    } else {
      const lw = Math.max(...itemW);
      const lh = entries.length * legendText.size * 1.4;
      const x = legendPos === 'l' ? left : right - lw;
      let y = (top + bottom) / 2 - lh / 2 + legendText.size * 0.7;
      for (const e of entries) {
        out.push(legendKey(e, x, y, ks));
        out.push(label(e.name, x + (e.line ? ks * 3 : ks) + 4, y, legendText, 'start'));
        y += legendText.size * 1.4;
      }
      if (legendPos === 'l') left += lw + 8;
      else right -= lw + 8;
    }
  }

  // ---------------- 绘图区（手动布局优先）
  const ml = path(plotArea, 'c:layout', 'c:manualLayout');
  if (ml && numAttr(child(ml, 'c:w'), 'val') !== undefined) {
    const fx = numAttr(child(ml, 'c:x'), 'val') ?? 0, fy = numAttr(child(ml, 'c:y'), 'val') ?? 0;
    const fw = numAttr(child(ml, 'c:w'), 'val') ?? 1, fh = numAttr(child(ml, 'c:h'), 'val') ?? 1;
    left = fx * w; top = fy * h; right = left + fw * w; bottom = top + fh * h;
  }

  const makeAxis = axisMaker(colors, baseText, env.part);
  if (type0.layout === 'standalone') {
    const ctx: ChartContext = { colors, part: env.part, baseText, plotArea, makeAxis, width: tw, box: { w, h } };
    out.push(type0.render!(plots[0], { left, top, right, bottom }, ctx));
    return out.join('');
  }

  // ---------------- 坐标轴（分类轴图）
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

  const vpos = prim.pos;
  // 网格线
  const gridLine = prim.grid;
  prim.ticks.forEach((t, i) => {
    const f = vpos(t);
    if (!horizontal) {
      const y = bottom - f * ph;
      if (gridLine?.color) out.push(`<line x1="${n2(left)}" y1="${n2(y)}" x2="${n2(right)}" y2="${n2(y)}" stroke="${css(gridLine.color)}" stroke-width="${n2(gridLine.width)}"/>`);
      if (!valDeleted) out.push(label(tickLabels[i], left - sideAnchor(valStyle.size), y, valStyle, 'end'));
    } else {
      const x = left + f * pw;
      if (gridLine?.color) out.push(`<line x1="${n2(x)}" y1="${n2(top)}" x2="${n2(x)}" y2="${n2(bottom)}" stroke="${css(gridLine.color)}" stroke-width="${n2(gridLine.width)}"/>`);
      if (!valDeleted) out.push(label(tickLabels[i], x, bottom + valCenter(valStyle.size), valStyle));
    }
  });
  if (sec && !sec.deleted && !horizontal) {
    sec.ticks.forEach((t, i) => out.push(label(sec.labels[i], right + sideAnchor(sec.style.size), bottom - sec.pos(t) * ph, sec.style, 'start')));
  }

  // 分类轴
  const catLine = parseLine([child(child(catAx, 'c:spPr'), 'a:ln')], [colors], env.part);
  const band = (horizontal ? ph : pw) / (between ? nCat : Math.max(1, nCat - 1));
  const bandCenter = (i: number) => (between ? (i + 0.5) * band : i * band);
  if (!catDeleted) {
    cats.forEach((c, i) => {
      if (!horizontal) out.push(label(c, left + bandCenter(i), bottom + catCenter(catStyle.size), catStyle));
      else out.push(label(c, left - sideAnchor(catStyle.size), bottom - bandCenter(i), catStyle, 'end'));
    });
  }

  // ---------------- 系列（数据标签最后画，盖在图形上面）
  const frame: CategoryFrame = { left, top, right, bottom, pw, ph, band, catCenter: bandCenter, nCat, horizontal };
  const labelsOut: string[] = [];
  const zeroF = vpos(Math.max(prim.lo, Math.min(prim.hi, 0)));
  for (const p of plots) {
    // 每个图按自己的坐标轴换算；不是分类轴图的类型按折线画
    const A = onSecondary(p) && sec ? sec : prim;
    const t = chartTypeOf(p.kind);
    (t?.renderOnAxes ? t : lineType).renderOnAxes!(p, frame, A, out, labelsOut);
  }

  // 分类轴线（画在系列上面）
  if (catLine?.color && !catDeleted) {
    if (!horizontal) out.push(`<line x1="${n2(left)}" y1="${n2(bottom - zeroF * ph)}" x2="${n2(right)}" y2="${n2(bottom - zeroF * ph)}" stroke="${css(catLine.color)}" stroke-width="${n2(catLine.width)}"/>`);
    else out.push(`<line x1="${n2(left + zeroF * pw)}" y1="${n2(top)}" x2="${n2(left + zeroF * pw)}" y2="${n2(bottom)}" stroke="${css(catLine.color)}" stroke-width="${n2(catLine.width)}"/>`);
  }
  out.push(...labelsOut);
  return out.join('');
}
