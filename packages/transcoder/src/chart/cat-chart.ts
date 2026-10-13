/**
 * 分类轴图（柱、条、折线、面积，可以组合、带次坐标轴）的公共部分：算数值轴、留出坐标轴标签的空间、
 * 画网格和坐标轴标签，再把绘图区（CategoryFrame）交给每种类型画系列。
 */
import type { ColorContext } from '../model/color';
import { parseLine } from '../style/line';
import { n2 } from '../common/svg';
import { attr, child, type XEl } from '../io/xml';
import { axesOf, axId, axisCrosses, axisReversed, tickMark } from './axis';
import type { CategoryFrame } from './chart-type';
import { chartTypeOf } from './chart-types';
import { hasCjk, label, textStyle } from './draw';
import { catBand, catCenter, PAD, RIGHT_LABEL_PAD, SIDE_LABEL_PAD, sideAnchor, sideGap, topForLabel, unitBand, unitCenter, unitTop, valBand, valBandTop, emptySidePad, valCenter, type TextWidth } from './layout';
import { axisLine, axisSides, catMapping, gridLine, outward, tickLblPos, tickMarks } from './sides';
import type { AxisMaker, AxisOpts, Plot, Rect, TextStyle, View3D } from './model';
import { isColumn3D, renderColumn3D } from './cat3d';
import { isColumnDepth3D, renderColumnDepth3D } from './cat3d-depth';
import { lineType } from './types/line-area';
import { extraValues, trendlines } from './extras';
import { dataTableSize, readDataTable, renderDataTable } from './data-table';
import { readAxisTitle, renderAxisTitles, reserveAxisTitles, type AxisTitles } from './axis-title';

export interface CatEnv { colors: ColorContext; part: string; baseText: TextStyle; makeAxis: AxisMaker; tw: TextWidth; w: number; view?: View3D; zh?: boolean; plotBg?: (r: Rect) => string }

export function renderCategoryChart(plots: Plot[], plotArea: XEl | undefined, area0: Rect, env: CatEnv, out: string[]): void {
  const { colors, baseText, makeAxis, tw, w } = env;
  const { valAxes, catAxes } = axesOf(plotArea);
  const axisOf = (p: Plot) => valAxes.find((a) => p.axIds.includes(axId(a))) ?? valAxes[0];
  const catAx = catAxes.find((a) => plots[0].axIds.includes(axId(a))) ?? catAxes[0];
  const horizontal = plots.some((p) => chartTypeOf(p.kind)?.horizontal?.(p) ?? false);
  // 坐标轴标题：先让出位置（条形图的分类轴在左边、数值轴在下边）
  const title = (ax: XEl | undefined) => readAxisTitle(ax, colors, baseText, env.zh ?? true);
  const titles: AxisTitles = horizontal ? { left: title(catAx), bottom: title(axisOf(plots[0])) } : { left: title(axisOf(plots[0])), bottom: title(catAx) };
  const area = reserveAxisTitles(area0, titles);
  // 三维柱形图（直角坐标轴）：墙、斜网格线、立方体，单独画
  if (isColumnDepth3D(plots, env.view)) {
    const serAx = plotArea?.children.find((c) => c.name === 'c:serAx');
    renderColumnDepth3D(plots[0], axisOf(plots[0]), catAx, serAx, area, { ...env, view: env.view! }, out);
    renderAxisTitles(titles, area, area0, out);
    return;
  }
  if (isColumn3D(plots, env.view)) {
    renderColumn3D(plots[0], axisOf(plots[0]), catAx, area, { ...env, view: env.view! }, out);
    renderAxisTitles(titles, area, area0, out);
    return;
  }
  const catStyle = textStyle(child(catAx, 'c:txPr'), colors, baseText);
  const cats = plots[0].series[0]?.cats ?? [];
  const nCat = Math.max(1, ...plots.flatMap((p) => p.series.map((s) => s.vals.length)));

  // 数值范围（堆积按每个分类求和）；最后一项是最小的正数（对数刻度用）
  const rangeOf = (ps: Plot[]): [number, number, AxisOpts] => {
    let vmin = 0, vmax = 0, minPos = Infinity;
    for (const p of ps) {
      if (p.grouping === 'percentStacked') { vmax = Math.max(vmax, 1); continue; }
      if (p.grouping === 'stacked') {
        for (let i = 0; i < nCat; i++) {
          let pos = 0, neg = 0;
          for (const s of p.series) { const v = s.vals[i] ?? 0; if (v >= 0) pos += v; else neg += v; }
          vmax = Math.max(vmax, pos); vmin = Math.min(vmin, neg);
          if (pos > 0) minPos = Math.min(minPos, pos);
        }
      } else {
        for (const s of p.series) {
          // 趋势线、误差线也要放得下
          for (const v of [...s.vals, ...extraValues(s, (i) => i + 1)]) if (v !== null) { vmax = Math.max(vmax, v); vmin = Math.min(vmin, v); if (v > 0) minPos = Math.min(minPos, v); }
        }
      }
    }
    return [vmin, vmax, { pct: ps.some((p) => p.grouping === 'percentStacked'), minPos }];
  };
  // 主坐标轴和次坐标轴（组合图里某些系列画在右侧的次坐标轴上）
  const primaryAx = axisOf(plots[0]);
  const secondaryAx = valAxes.find((a) => a !== primaryAx && plots.some((p) => axisOf(p) === a));
  const onSecondary = (p: Plot) => !!secondaryAx && axisOf(p) === secondaryAx;
  const primRange = rangeOf(plots.filter((p) => !onSecondary(p)));
  const secRange = rangeOf(plots.filter(onSecondary));
  const catDeleted = attr(child(catAx, 'c:delete'), 'val') === '1';
  // 底部分类标签带的高度、标签中心离轴的距离：带中文的标签和纯数字（日期等）不同（实测）
  const cjk = cats.some(hasCjk);
  const catH = (s: number) => (cjk ? catBand(s) : valBand(s));
  const catC = (s: number) => (cjk ? catCenter(s) : valCenter(s));
  // 数据表（柱形、折线、面积图）：表头代替分类标签，表格占绘图区下方和左边一列
  const dt = horizontal ? undefined : readDataTable(plotArea, colors, baseText, env.part);
  const dtSize = dt ? dataTableSize(dt, plots, colors, tw) : undefined;
  const catLabels = !catDeleted && tickLblPos(catAx) !== 'none' && !dt;
  // 按数值轴的长度 len 算刻度并排出绘图区（len 不给时用默认刻度）
  const place = (len?: number) => {
    const prim = makeAxis(primaryAx, primRange[0], primRange[1], { ...primRange[2], length: len, horizontal });
    const sec = secondaryAx ? makeAxis(secondaryAx, secRange[0], secRange[1], { ...secRange[2], length: len }) : undefined;
    let { left, top, right, bottom } = area;
    const valStyle = prim.style;
    const tickLabels = prim.labels;
    const valLabels = !prim.deleted && prim.lblPos !== 'none';

    // 两根轴各在哪一侧（见 sides.ts）
    const sides = axisSides(horizontal, axisReversed(catAx), prim, axisCrosses(catAx), tickLblPos(catAx));
    // 显示单位的标签（例如"千"）竖着写在数值标签外侧
    const unit = valLabels && prim.unitLabel && !horizontal ? prim.unitLabel : undefined;
    const unitW = unit ? unitBand(unit.style.size) : 0;

    // 留出坐标轴标签的空间（实测规律见 layout.ts）：左右两侧的标签从图表边 SIDE_LABEL_PAD 处排起
    const maxW = (labels: string[], s: number) => Math.max(0, ...labels.map((t) => tw(t, s)));
    const fromLeft = () => (left === PAD ? SIDE_LABEL_PAD : left);
    const fromRight = () => (right === w - PAD ? w - SIDE_LABEL_PAD : right);
    const edgeLeft = fromLeft(), edgeRight = fromRight();
    if (!horizontal) {
      if (valLabels) {
        if (sides.val === 'l') left = edgeLeft + unitW + maxW(tickLabels, valStyle.size) + sideGap(valStyle.size);
        else right = edgeRight - unitW - maxW(tickLabels, valStyle.size) - sideGap(valStyle.size);
        top = Math.max(top, topForLabel(valStyle.size));
      }
      if (sec && !sec.deleted) right = fromRight() - maxW(sec.labels, sec.style.size) - sideGap(sec.style.size);
      if (dtSize) {
        bottom -= dtSize.height;
        left = Math.max(left, dtSize.colRight);
      }
      if (catLabels) {
        if (sides.catMid) bottom -= emptySidePad(catStyle.size);
        else if (sides.cat === 'b') bottom -= catH(catStyle.size);
        else top += catH(catStyle.size);
      }
    } else {
      if (catLabels) {
        if (sides.catMid) left += emptySidePad(catStyle.size);
        else if (sides.cat === 'l') left = edgeLeft + maxW(cats, catStyle.size) + sideGap(catStyle.size);
        else right = edgeRight - maxW(cats, catStyle.size) - sideGap(catStyle.size);
      }
      if (valLabels) {
        if (sides.val === 'b') bottom -= valBand(valStyle.size);
        else { top += valBandTop(valStyle.size); bottom -= emptySidePad(valStyle.size); }
        right = Math.min(right, w - RIGHT_LABEL_PAD - tw(tickLabels[tickLabels.length - 1] ?? '', valStyle.size) / 2);
      }
    }
    // 分类标签落在坐标轴两端（面积图等 midCat）时，给首尾标签各留半个标签宽度
    const between = attr(child(primaryAx, 'c:crossBetween'), 'val') !== 'midCat';
    if (!between && !horizontal && catLabels && cats.length) {
      left = Math.max(left, PAD + tw(cats[0], catStyle.size) / 2);
      right = Math.min(right, w - PAD - tw(cats[cats.length - 1], catStyle.size) / 2);
    }
    return { prim, sec, left, top, right, bottom, sides, unit, edgeLeft, edgeRight, valLabels, valStyle, tickLabels, between };
  };
  // 自动刻度的疏密取决于轴长（axis.ts）：先按默认刻度排一遍得到轴长，再按轴长选刻度重排
  const first = place();
  const { prim, sec, left, top, right, bottom, sides, unit, edgeLeft, edgeRight, valLabels, valStyle, tickLabels, between } =
    place(horizontal ? first.right - first.left : first.bottom - first.top);
  const pw = Math.max(1, right - left), ph = Math.max(1, bottom - top);
  const band = (horizontal ? ph : pw) / (between ? nCat : Math.max(1, nCat - 1));
  const bandCenter = (i: number) => (between ? (i + 0.5) * band : i * band);
  const box: Rect = { left, top, right, bottom };
  const frame: CategoryFrame = {
    left, top, right, bottom, pw, ph, band, catCenter: bandCenter, nCat, horizontal,
    ...catMapping(box, horizontal, sides.catRev),
    valPx: horizontal ? (f) => left + f * pw : (f) => bottom - f * ph,
  };

  // 坐标轴标签画在系列和轴线上面（实测：分类轴在中间时标签盖在柱子上）
  const axisText: string[] = [];
  // 绘图区的背景和边框在最下面
  if (env.plotBg) out.push(env.plotBg(box));
  // 网格线（次要的在下面）和数值标签
  for (const t of prim.minor) out.push(gridLine(frame.valPx(prim.pos(t)), prim.minorGrid, horizontal, box));
  prim.ticks.forEach((t, i) => {
    const v = frame.valPx(prim.pos(t));
    out.push(gridLine(v, prim.grid, horizontal, box));
    if (!valLabels) return;
    if (!horizontal) axisText.push(sides.val === 'l' ? label(tickLabels[i], left - sideAnchor(valStyle.size), v, valStyle, 'end') : label(tickLabels[i], right + sideAnchor(valStyle.size), v, valStyle, 'start'));
    else axisText.push(label(tickLabels[i], v, sides.val === 'b' ? bottom + valCenter(valStyle.size) : top - valCenter(valStyle.size), valStyle));
  });
  // 显示单位（例如"千"）
  if (unit) {
    const x = sides.val === 'l' ? edgeLeft + unitCenter(unit.style.size) : edgeRight - unitCenter(unit.style.size);
    axisText.push(`<g transform="translate(${n2(x)} ${n2(top + unitTop(unit.style.size))}) rotate(-90)">${label(unit.text, 0, 0, unit.style, 'end')}</g>`);
  }
  if (sec && !sec.deleted && !horizontal) {
    sec.ticks.forEach((t, i) => axisText.push(label(sec.labels[i], right + sideAnchor(sec.style.size), frame.valPx(sec.pos(t)), sec.style, 'start')));
  }

  // 分类轴标签：挨着绘图区的边，或者挨着中间的分类轴线
  if (catLabels) {
    const edge = sides.catMid ? frame.valPx(prim.pos(sides.catCross)) : sides.cat === 'b' ? bottom : sides.cat === 't' ? top : sides.cat === 'l' ? left : right;
    cats.forEach((c, i) => {
      const at = frame.catPx(bandCenter(i));
      if (!horizontal) axisText.push(label(c, at, sides.cat === 'b' ? edge + catC(catStyle.size) : edge - catC(catStyle.size), catStyle));
      else axisText.push(sides.cat === 'l' ? label(c, edge - sideAnchor(catStyle.size), at, catStyle, 'end') : label(c, edge + sideAnchor(catStyle.size), at, catStyle, 'start'));
    });
  }

  // ---------------- 系列（数据标签最后画，盖在图形上面）
  const labelsOut: string[] = [];
  for (const p of plots) {
    // 每个图按自己的坐标轴换算；不是分类轴图的类型按折线画
    const A = onSecondary(p) && sec ? sec : prim;
    const t = chartTypeOf(p.kind);
    (t?.renderOnAxes ? t : lineType).renderOnAxes!(p, frame, A, out, labelsOut);
    // 趋势线：x 是分类序号 1、2、3……
    for (const s of p.series) {
      out.push(...trendlines(s, (i) => i + 1, (x, y) => {
        const c = frame.catPx(bandCenter(x - 1)), v = frame.valPx(A.pos(y));
        return horizontal ? [v, c] : [c, v];
      }));
    }
  }

  // 坐标轴线和刻度线（画在系列上面）
  const catLine = parseLine([child(child(catAx, 'c:spPr'), 'a:ln')], [colors], env.part);
  if (catLine?.color && !catDeleted) {
    const at = frame.valPx(prim.pos(sides.catCross));
    // 刻度在分类之间（midCat 时在每个分类上）
    const marks = Array.from({ length: between ? nCat + 1 : nCat }, (_, i) => frame.catPx(i * band));
    out.push(axisLine(horizontal ? 'v' : 'h', at, box, catLine));
    out.push(tickMarks(marks, at, horizontal ? 'v' : 'h', outward(sides.cat), tickMark(catAx, 'c:majorTickMark'), catLine));
  }
  if (prim.axisLine?.color && !prim.deleted) {
    const at = sides.val === 'l' ? left : sides.val === 'r' ? right : sides.val === 'b' ? bottom : top;
    const dir = horizontal ? 'h' : 'v';
    out.push(axisLine(dir, at, box, prim.axisLine));
    out.push(tickMarks(prim.ticks.map((t) => frame.valPx(prim.pos(t))), at, dir, outward(sides.val), prim.majorMark, prim.axisLine));
    out.push(tickMarks(prim.minor.map((t) => frame.valPx(prim.pos(t))), at, dir, outward(sides.val), prim.minorMark, prim.axisLine));
  }
  out.push(...axisText);
  renderAxisTitles(titles, box, area0, out);
  if (dt) renderDataTable(dt, plots, cats, colors, tw, bottom, left, right, band, out);
  out.push(...labelsOut);
}
