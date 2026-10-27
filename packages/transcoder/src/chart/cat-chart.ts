/**
 * 分类轴图（柱、条、折线、面积，可以组合、带次坐标轴）的公共部分：算数值轴、留出坐标轴标签的空间、
 * 画网格和坐标轴标签，再把绘图区（CategoryFrame）交给每种类型画系列。
 */
import { css, type ColorContext } from '../model/color';
import { parseLine, type Line } from '../style/line';
import { lineOrDefault } from './default-lines';
import { n2 } from '../common/svg';
import { attr, child, numAttr, type XEl } from '../io/xml';
import { axesOf, axId, axisCrosses, axisReversed, tickMark } from './axis';
import type { CategoryFrame } from './chart-type';
import { chartTypeOf } from './chart-types';
import { hasCjk, label, textStyle } from './draw';
import { catBand, catCenter, PAD, SIDE_LABEL_PAD, sideAnchor, sideGap, valAnchor, topForLabel, unitBand, unitCenter, unitTop, valBand, valBandTop, emptyBottomPad, emptyLeftPad, valCenter, withFont, type TextWidth } from './layout';
import { axisLine, axisSides, catMapping, gridLine, outward, tickLblPos, tickMarks } from './sides';
import type { AxisMaker, AxisOpts, Plot, Rect, TextStyle, View3D } from './model';
import { isColumn3D, renderColumn3D } from './cat3d';
import { isColumnDepth3D, renderColumnDepth3D } from './cat3d-depth';
import { isPersp3D, renderPersp3D } from './cat3d-persp';
import { lineType } from './types/line-area';
import { extraValues, trendlines } from './extras';
import { dataTableSize, headerLines, headerLineStep, readDataTable, renderDataTable } from './data-table';
import { innerTitleAt, readAxisTitle, renderAxisTitles, reserveAxisTitles, type AxisTitles } from './axis-title';
import { NO_GRID, type PixelGrid } from './pixel-grid';
import { catBandShift, latinShift, lineFactor } from './font-lines';
import { catFitBand, categoryLabel, fitCategoryLabels, outerLevelBands, outerLevels, ROT_MIDCAT_RIGHT, rotFirstCenter, sideLabel, sideLabelMax, sideLevelBands, sideOuterLevels, wrapSideLabel, type CatFit, type LevelBand, capVertical } from './cat-labels';

/** 条形图两侧的分类标签每行要的高度（× 字号）：样本校准（27 个分类、24 磅，每个分类约 20 像素高，PowerPoint 隔一个显示；1.3 时会隔两个） */
const SIDE_ROOM = 1.2;

/** inner：area 就是绘图区内框（手动布局的 layoutTarget="inner"），坐标轴标签画在它外面，不再从里面让位置 */
export interface CatEnv { colors: ColorContext; part: string; baseText: TextStyle; makeAxis: AxisMaker; tw: TextWidth; w: number; h?: number; view?: View3D; zh?: boolean; plotBg?: (r: Rect) => string; snap?: PixelGrid; inner?: boolean; defLine?: Line }

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
  // 透视的三维折线图、面积图：箱体、墙上网格线、带子和厚片，单独画
  if (isPersp3D(plots, env.view)) {
    const serAx = plotArea?.children.find((c) => c.name === 'c:serAx');
    renderPersp3D(plots[0], axisOf(plots[0]), catAx, serAx, area, { ...env, view: env.view! }, out);
    renderAxisTitles(titles, area, area0, out);
    return;
  }
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
    // vmin 是真实的最小值（自动刻度要看数据挤不挤在一起，axis.ts 的 niceScale）；没有数据时按 0
    let vmin = Infinity, vmax = 0, minPos = Infinity;
    for (const p of ps) {
      if (p.grouping === 'percentStacked') { vmax = Math.max(vmax, 1); vmin = Math.min(vmin, 0); continue; }
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
    return [Number.isFinite(vmin) ? vmin : 0, vmax, { pct: ps.some((p) => p.grouping === 'percentStacked'), minPos }];
  };
  // 主坐标轴和次坐标轴（组合图里某些系列画在右侧的次坐标轴上）
  const primaryAx = axisOf(plots[0]);
  // 删掉了、又是自动刻度的次坐标轴：上面的系列按主坐标轴的刻度画（实测 charts-dlbl-numfmt：次坐标轴上 0.3 的折线贴着底，不是自己撑满）
  const autoDeleted = (a: XEl) => attr(child(a, 'c:delete'), 'val') === '1' && !child(child(a, 'c:scaling'), 'c:min') && !child(child(a, 'c:scaling'), 'c:max');
  const secondaryAx = valAxes.find((a) => a !== primaryAx && !autoDeleted(a) && plots.some((p) => axisOf(p) === a));
  const onSecondary = (p: Plot) => !!secondaryAx && axisOf(p) === secondaryAx;
  // 反过来主坐标轴删掉了、又是自动刻度：两根轴按全部系列共用一个刻度（实测 combo 图删主轴后次坐标轴读数和主轴一样，不再按自己的数据放大）
  const shared = !!secondaryAx && autoDeleted(primaryAx);
  const primRange = rangeOf(shared ? plots : plots.filter((p) => !onSecondary(p)));
  const secRange = shared ? primRange : rangeOf(plots.filter(onSecondary));
  const catDeleted = attr(child(catAx, 'c:delete'), 'val') === '1';
  // 底部分类标签带的高度、标签中心离轴的距离：带中文的标签和纯数字（日期等）不同（实测）；字体比等线高的再加（font-lines.ts）
  const cjk = cats.some(hasCjk);
  const catShift = catBandShift(catStyle, cats, tw), catLf = lineFactor(catStyle, cats, tw);
  const catH = (s: number) => (cjk ? catBand(s) : valBand(s)) + catShift;
  const catC = (s: number) => (cjk ? catCenter(s) : valCenter(s)) + catShift / 2;
  // 数据表（柱形、折线、面积图）：表头代替分类标签，表格占绘图区下方和左边一列
  const dt = horizontal ? undefined : readDataTable(plotArea, colors, baseText, env.part);
  const dtSize = dt ? dataTableSize(dt, plots, colors, tw) : undefined;
  const catLabels = !catDeleted && tickLblPos(catAx) !== 'none' && !dt;
  // 分类标签、刻度线的间隔（"标签间隔""刻度线间隔"，没写时标签间隔按能不能放下自动定，见 cat-labels.ts）
  const lblSkip = Math.max(1, numAttr(child(catAx, 'c:tickLblSkip'), 'val') ?? 1), markSkip = Math.max(1, numAttr(child(catAx, 'c:tickMarkSkip'), 'val') ?? 1);
  // 多级分类的外层（"不显示多级标签"时不画）
  const catLevels = attr(child(catAx, 'c:noMultiLvlLbl'), 'val') === '1' ? [] : plots[0].series[0]?.catLevels ?? [];
  // 左右两侧的分类标签（条形图）太长时折行（cat-labels.ts）
  const catTw = withFont(tw, catStyle.font);
  const sideLines = cats.map((c) => wrapSideLabel(c, sideLabelMax(w, PAD), catStyle.size, catTw));
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
    const maxW = (labels: string[], st: TextStyle) => Math.max(0, ...labels.map((t) => tw(t, st.size, st.font)));
    const fromLeft = () => (left === PAD ? SIDE_LABEL_PAD : left);
    const fromRight = () => (right === w - PAD ? w - SIDE_LABEL_PAD : right);
    const edgeLeft = fromLeft(), edgeRight = fromRight();
    let innerBand = 0, levelBands: LevelBand[] = [];
    if (!horizontal) {
      if (valLabels) {
        if (sides.val === 'l') left = edgeLeft + unitW + maxW(tickLabels, valStyle) + sideGap(valStyle.size);
        else right = edgeRight - unitW - maxW(tickLabels, valStyle) - sideGap(valStyle.size);
        top = Math.max(top, topForLabel(valStyle.size) + latinShift(valStyle, tw) / 2);
      }
      if (sec && !sec.deleted) right = fromRight() - maxW(sec.labels, sec.style) - sideGap(sec.style.size);
      if (dtSize) {
        left = Math.max(left, dtSize.colRight);
        // 表头分类名放不下时折行，表头行加高、绘图区让出（实测 charts-dtable-wrap）
        const heads = headerLines(dt!, cats, (right - left) / Math.max(1, nCat), tw);
        bottom -= dtSize.reserve + (Math.max(1, ...heads.map((l) => l.length)) - 1) * headerLineStep(dt!, tw);
      }
      if (catLabels) {
        if (sides.catMid) bottom -= emptyBottomPad(catStyle.size);
        else if (sides.cat !== 'b') top += catH(catStyle.size);
      }
    } else {
      if (catLabels) {
        if (sides.catMid) left += emptyLeftPad(catStyle.size);
        else if (sides.cat === 'l') {
          // 多级分类的外层各占一列，排在内层标签左边（cat-labels.ts）
          levelBands = sideLevelBands(catLevels, catStyle.size);
          left = edgeLeft + levelBands.reduce((a, b) => a + b.band, 0) + maxW(sideLines.flat(), catStyle) + sideGap(catStyle.size);
        }
        else right = edgeRight - maxW(sideLines.flat(), catStyle) - sideGap(catStyle.size);
      }
      if (valLabels) {
        if (sides.val === 'b') bottom -= valBand(valStyle.size) + catBandShift(valStyle, tickLabels, tw);
        else { top += valBandTop(valStyle.size); bottom -= emptyBottomPad(valStyle.size); }
        // 最右边的标签以网格线为中心：在可用区域（图表边 11 磅，或者右侧图例让出之后）里再让出半个标签（COM 读绘图区右沿）
        right = Math.min(right, area.right - tw(tickLabels[tickLabels.length - 1] ?? '', valStyle.size, valStyle.font) / 2);
      }
    }
    // 分类标签落在坐标轴两端（面积图等 midCat）时，给首尾标签各留半个标签宽度
    const between = attr(child(primaryAx, 'c:crossBetween'), 'val') !== 'midCat';
    const [left0, right0] = [left, right];
    if (!between && !horizontal && catLabels && cats.length) {
      left = Math.max(left, PAD + catTw(cats[0], catStyle.size) / 2);
      right = Math.min(right, w - PAD - catTw(cats[cats.length - 1], catStyle.size) / 2);
    }
    // 底部分类标签：放不下时折行或整体转斜（cat-labels.ts），转斜时左边让出第一个标签
    let catFit: CatFit = { kind: 'line', skip: lblSkip };
    if (!horizontal && catLabels && !sides.catMid && sides.cat === 'b') {
      const bands = between ? nCat : Math.max(1, nCat - 1);
      // 日期轴：放不放得下按 绘图区宽 / 分类数 算，分类在端点上（面积图）也是（实测 charts-pct-stacked：5 个日期、标签宽 0.97 倍时转斜）
      const fitBands = catAx?.name === 'c:dateAx' ? nCat : bands;
      const bodyPr = child(child(catAx, 'c:txPr'), 'a:bodyPr');
      const eaVert = attr(bodyPr, 'vert') === 'eaVert';
      // 自定义角度：rot 在 ±90° 以内、不是 0（PowerPoint 写的 −60000000 是"自动"）
      const rot = numAttr(bodyPr, 'rot');
      const deg = rot !== undefined && rot !== 0 && Math.abs(rot) < 5400000 ? rot / 60000 : undefined;
      catFit = fitCategoryLabels(cats, (right - left) / fitBands, catStyle.size, catTw, numAttr(child(catAx, 'c:tickLblSkip'), 'val'), eaVert, deg, catLf);
      levelBands = outerLevelBands(catLevels, catStyle.size, (c, sz) => (c ? catBand(sz) : valBand(sz)));
      catFit = capVertical(catFit, cats, catStyle.size, catTw, bottom - top - levelBands.reduce((a, b) => a + b.band, 0));
      if (catFit.kind === 'rot' && cats.length) {
        // 斜标签不往右伸，不用给首尾留半个宽度；分类在端点上时右边仍留约 1.05 × 字号（面积图一个样例）；第一个标签按截断后的算
        [left, right] = [left0, between ? right0 : Math.min(right0, area.right - ROT_MIDCAT_RIGHT * catStyle.size)];
        const f = between ? 0.5 / bands : 0;
        // 往右斜（顺时针）的标签伸向右边：最后一个分类中心离右边留够（实测 charts-cat-custom-rot）
        if (catFit.deg !== undefined && catFit.deg > 0) right = Math.min(right, (w - rotFirstCenter(catFit.cut?.[cats.length - 1] ?? cats[cats.length - 1], catStyle.size, catTw, catFit.deg) - f * left) / (1 - f));
        else left = Math.max(left, (rotFirstCenter(catFit.cut?.[0] ?? cats[0], catStyle.size, catTw, catFit.deg) - f * right) / (1 - f));
      }
      innerBand = catFitBand(catFit, catH(catStyle.size), cats, catStyle.size, catTw);
      bottom -= innerBand + levelBands.reduce((a, b) => a + b.band, 0);
      // 手动布局的内框：绘图区就是给的框，分类标签按它的宽度排、画在框外，不截断（样本：矮图表的斜标签以前被截成两个字）
      if (env.inner) catFit = fitCategoryLabels(cats, (area0.right - area0.left) / fitBands, catStyle.size, catTw, numAttr(child(catAx, 'c:tickLblSkip'), 'val'), eaVert, deg, catLf);
    }
    // 手动内框：绘图区就是给的框（不给坐标轴标题让位置），标题贴在"内框 + 标签带"外面
    const titleAt = env.inner ? innerTitleAt(area0, area, { left, bottom }) : undefined;
    if (env.inner) ({ left, top, right, bottom } = area0);
    return { prim, sec, left, top, right, bottom, sides, unit, edgeLeft, edgeRight, valLabels, valStyle, tickLabels, between, catFit, innerBand, levelBands, titleAt };
  };
  // 自动刻度的疏密取决于轴长（axis.ts）：先按默认刻度排一遍得到轴长，再按轴长选刻度重排
  const first = place();
  // 横向数值轴（条形图）的刻度疏密按"绘图区宽 + 左右分类标签列宽的一半"算（COM 探针：长分类名的条形图刻度比按绘图区宽算的密）
  const sideCol = horizontal && catLabels && !first.sides.catMid ? Math.max(0, ...sideLines.flat().map((t) => catTw(t, catStyle.size))) + sideGap(catStyle.size) : 0;
  const placed = place(horizontal ? first.right - first.left + sideCol / 2 : first.bottom - first.top);
  const { prim, sec, sides, unit, edgeLeft, edgeRight, valLabels, valStyle, tickLabels, between, catFit, innerBand, levelBands, titleAt } = placed;
  const { left, top, right, bottom } = placed;
  // 网格线、坐标轴线、柱子按像素中心的规则对齐整像素（pixel-grid.ts）
  const g = env.snap ?? NO_GRID;
  const pw = Math.max(1, right - left), ph = Math.max(1, bottom - top);
  const band = (horizontal ? ph : pw) / (between ? nCat : Math.max(1, nCat - 1));
  const bandCenter = (i: number) => (between ? (i + 0.5) * band : i * band);
  const box: Rect = { left, top, right, bottom };
  const frame: CategoryFrame = {
    left, top, right, bottom, pw, ph, band, catCenter: bandCenter, nCat, horizontal,
    ...catMapping(box, horizontal, sides.catRev),
    valPx: horizontal ? (f) => left + f * pw : (f) => bottom - f * ph,
    snap: g,
    chart: { w, h: env.h ?? 0 },
  };

  // 坐标轴标签画在系列和轴线上面（实测：分类轴在中间时标签盖在柱子上）
  const axisText: string[] = [];
  // 绘图区的背景和边框在最下面
  if (env.plotBg) out.push(env.plotBg(box));
  // 分类轴的主要网格线：画在刻度线的位置（分类之间，含绘图区两端；按刻度线间隔）
  const catGrid = child(catAx, 'c:majorGridlines');
  if (catGrid && !catDeleted) {
    const ln = env.defLine ? lineOrDefault(catGrid, colors, env.part, env.defLine) : parseLine([child(child(catGrid, 'c:spPr'), 'a:ln')], [colors], env.part) ?? { color: { r: 217, g: 217, b: 217, a: 1 }, width: 1, cap: 'butt', join: 'round' };
    if (ln) for (let i = 0; i <= (between ? nCat : nCat - 1); i += markSkip) out.push(gridLine(frame.catPx(i * band), ln, !horizontal, box, g));
  }
  // 网格线（次要的在下面）和数值标签
  for (const t of prim.minor) out.push(gridLine(frame.valPx(prim.pos(t)), prim.minorGrid, horizontal, box, g));
  prim.ticks.forEach((t, i) => {
    const v = frame.valPx(prim.pos(t));
    out.push(gridLine(v, prim.grid, horizontal, box, g));
    if (!valLabels) return;
    if (!horizontal) axisText.push(sides.val === 'l' ? label(tickLabels[i], left - valAnchor(valStyle.size), v, valStyle, 'end') : label(tickLabels[i], right + sideAnchor(valStyle.size), v, valStyle, 'start'));
    else axisText.push(label(tickLabels[i], v, sides.val === 'b' ? bottom + valCenter(valStyle.size) + catBandShift(valStyle, tickLabels, tw) / 2 : top - valCenter(valStyle.size), valStyle));
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
    // 条形图两侧的分类标签：每个分类的高度放不下标签（SIDE_ROOM × 字号一行）时隔几个显示，文件里写了间隔时按文件
    // （样本实测：27 个分类、24 磅的字，PowerPoint 隔一个显示）
    const sideSkip = horizontal && !child(catAx, 'c:tickLblSkip')
      ? Math.max(1, Math.ceil((SIDE_ROOM * catStyle.size * Math.max(1, ...sideLines.map((l) => l.length))) / Math.max(1e-6, band)))
      : 1;
    cats.forEach((c, i) => {
      const at = frame.catPx(bandCenter(i));
      if (i % catFit.skip || i % sideSkip) return;
      if (!horizontal) {
        axisText.push(sides.cat === 'b' && !sides.catMid ? categoryLabel(catFit, i, c, at, edge, edge + catC(catStyle.size), catStyle, catTw)
          : label(c, at, sides.cat === 'b' ? edge + catC(catStyle.size) : edge - catC(catStyle.size), catStyle));
      }
      else axisText.push(sides.cat === 'l' ? sideLabel(sideLines[i], edge - sideAnchor(catStyle.size), at, catStyle, 'end', tw) : sideLabel(sideLines[i], edge + sideAnchor(catStyle.size), at, catStyle, 'start', tw));
    });
    if (levelBands.length) {
      const ln = parseLine([child(child(catAx, 'c:spPr'), 'a:ln')], [colors], env.part);
      const sep = ln?.color ? { color: css(ln.color), width: ln.width } : undefined;
      const pos = (k: number) => frame.catPx(k * band);
      axisText.push(horizontal ? sideOuterLevels(levelBands, nCat, pos, edge, edgeLeft, catStyle, sep)
        : outerLevels(levelBands, nCat, pos, edge, edge + innerBand, catStyle, (c, sz) => (c ? catCenter(sz) : valCenter(sz)), sep));
    }
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
  const catLine = env.defLine ? lineOrDefault(catAx, colors, env.part, env.defLine) : parseLine([child(child(catAx, 'c:spPr'), 'a:ln')], [colors], env.part);
  if (catLine?.color && !catDeleted) {
    const at = frame.valPx(prim.pos(sides.catCross));
    // 刻度在分类之间（midCat 时在每个分类上）
    const marks = Array.from({ length: between ? nCat + 1 : nCat }, (_, i) => frame.catPx(i * band)).filter((_, i) => i % markSkip === 0);
    out.push(axisLine(horizontal ? 'v' : 'h', at, box, catLine, g));
    out.push(tickMarks(marks, at, horizontal ? 'v' : 'h', outward(sides.cat), tickMark(catAx, 'c:majorTickMark'), catLine, g));
  }
  if (prim.axisLine?.color && !prim.deleted) {
    const at = sides.val === 'l' ? left : sides.val === 'r' ? right : sides.val === 'b' ? bottom : top;
    const dir = horizontal ? 'h' : 'v';
    out.push(axisLine(dir, at, box, prim.axisLine, g));
    out.push(tickMarks(prim.ticks.map((t) => frame.valPx(prim.pos(t))), at, dir, outward(sides.val), prim.majorMark, prim.axisLine, g));
    out.push(tickMarks(prim.minor.map((t) => frame.valPx(prim.pos(t))), at, dir, outward(sides.val), prim.minorMark, prim.axisLine, g));
  }
  out.push(...axisText);
  renderAxisTitles(titles, box, area0, out, titleAt, { w, h: env.h ?? 0 }, tw);
  if (dt) renderDataTable(dt, plots, cats, colors, tw, bottom, left, right, band, g, out);
  out.push(...labelsOut);
}
