/** 从 c:plotArea 读出所有图（plot）和系列 */
import { colorIn, type ColorContext, type Rgba } from '../model/color';
import { findFillEl, parseFill } from '../style/fill';
import { parseLine, type Line } from '../style/line';
import { attr, child, children, findAll, numAttr, type XEl } from '../io/xml';
import { ACCENTS } from './draw';
import { cacheValues, formatNumber } from './format';
import { chartTypeOfTag } from './chart-types';
import { axesOf, axId, axisReversed } from './axis';
import { readErrBars } from './error-bars';
import { readTrendlines } from './trendline';
import type { GradFill, PattFill, Plot, Series, TextStyle } from './model';
import { readLabels, readPointLabels } from './point-labels';

/** spPr 里的纯色填充 */
function solidOf(spPr: XEl | undefined, colors: ColorContext, part: string): Rgba | undefined {
  const f = parseFill(findFillEl(spPr), colors, part);
  return f?.kind === 'solid' ? f.color : undefined;
}

/** 气泡大小（缺的、不是数字的记 null） */
function sizesOf(el: XEl | undefined, n: number): (number | null)[] {
  const c = cacheValues(el);
  return Array.from({ length: Math.max(n, c.count) }, (_, i) => {
    const v = Number(c.pts.get(i));
    return c.pts.has(i) && isFinite(v) ? v : null;
  });
}

/** zh：中文界面（决定趋势线等默认名称的语言，来自 c:lang） */
export function readPlots(plotArea: XEl | undefined, colors: ColorContext, part: string, baseText: TextStyle, warn: (m: string) => void, zh = true): Plot[] {
  const plots: Plot[] = [];
  let serialIdx = 0;
  for (const p of plotArea?.children ?? []) {
    const local = p.name.slice(2);
    const type = chartTypeOfTag(local);
    if (!type) {
      if (local.endsWith('Chart')) warn(`图表类型暂未支持：${local}`);
      continue;
    }
    const kind = type.kind;
    const rules = type.seriesRules(p, local);
    const plotLabels = readLabels(child(p, 'c:dLbls'), undefined, colors, baseText);
    // 日期轴：只画有日期的点，数值比日期多出来的不画、也不参与坐标轴范围（样本：38 个日期、50 个数值的折线）
    const ids = children(p, 'c:axId').map((a) => attr(a, 'val') ?? '');
    const dateCats = !rules.xy && children(plotArea, 'c:dateAx').some((a) => ids.includes(axId(a)));
    const series: Series[] = children(p, 'c:ser').map((s) => {
      const idx = numAttr(child(s, 'c:idx'), 'val') ?? serialIdx;
      const index = serialIdx++;
      const spPr = child(s, 'c:spPr');
      const fill = parseFill(findFillEl(spPr), colors, part);
      const accent = colorIn({ name: 'x', attrs: {}, text: '', children: [{ name: 'a:schemeClr', attrs: { val: ACCENTS[idx % 6] }, children: [], text: '' }] }, colors)!;
      const line = parseLine([child(spPr, 'a:ln')], [colors], part);
      const cat = cacheValues(child(s, rules.xy ? 'c:xVal' : 'c:cat'));
      const val = cacheValues(child(s, rules.xy ? 'c:yVal' : 'c:val'));
      const n = dateCats && cat.count ? cat.count : Math.max(cat.count, val.count);
      const cats: string[] = [];
      const vals: (number | null)[] = [];
      for (let i = 0; i < n; i++) {
        const c = cat.pts.get(i);
        cats.push(c === undefined ? String(i + 1) : cat.format !== 'General' && c !== '' && !isNaN(Number(c)) ? formatNumber(Number(c), cat.format) : c);
        const v = val.pts.get(i);
        // 不是数字的（Excel 错误值 #N/A 等）当空值：柱子不画、折线断开（实测 charts-na-values）
        const num = v === undefined || v === '' ? NaN : Number(v);
        vals.push(Number.isFinite(num) ? num : null);
      }
      const catLevels = cat.outer.length ? cat.outer : undefined;
      const pointFills = new Map<number, Rgba>();
      const pointGrads = new Map<number, GradFill>();
      const pointPatts = new Map<number, PattFill>();
      const pointLines = new Map<number, Line | null>();
      const explode = new Map<number, number>();
      for (const d of children(s, 'c:dPt')) {
        const at = numAttr(child(d, 'c:idx'), 'val') ?? 0;
        const f = parseFill(findFillEl(child(d, 'c:spPr')), colors, part);
        const dl = child(child(d, 'c:spPr'), 'a:ln');
        if (dl) pointLines.set(at, child(dl, 'a:noFill') ? null : parseLine([dl], [colors], part) ?? null);
        if (f?.kind === 'solid') pointFills.set(at, f.color);
        // 渐变：代表色取第一个色标（图例、标签等用），线性渐变另外留下
        if (f?.kind === 'grad' && f.stops.length) {
          pointFills.set(at, f.stops[0].color);
          if (!f.path) pointGrads.set(at, { stops: f.stops, angle: f.angle });
        }
        // 图案：代表色取前景色
        if (f?.kind === 'pattern') {
          pointFills.set(at, f.fg);
          pointPatts.set(at, { prst: f.prst, fg: f.fg, bg: f.bg });
        }
        const e = numAttr(child(d, 'c:explosion'), 'val');
        if (e !== undefined) explode.set(at, e);
      }
      const serExplode = numAttr(child(s, 'c:explosion'), 'val') ?? 0;
      const mk = child(s, 'c:marker');
      const symbol = attr(child(mk, 'c:symbol'), 'val');
      const hasLine = rules.defaultLine;
      const mkFill = parseFill(findFillEl(child(mk, 'c:spPr')), colors, part);
      const mkLine = parseLine([child(child(mk, 'c:spPr'), 'a:ln')], [colors], part);
      const marker = rules.marker(symbol);
      const name = findAll(child(s, 'c:tx'), 'c:v')[0]?.text ?? child(child(s, 'c:tx'), 'c:v')?.text ?? `系列 ${idx + 1}`;
      const serLabels = readLabels(child(s, 'c:dLbls'), plotLabels, colors, baseText);
      const pts = readPointLabels(child(s, 'c:dLbls'), serLabels, colors, baseText, s);
      return {
        index,
        labels: serLabels,
        ...(pts ? { pointLabels: pts.points, ...(pts.cells ? { labelCells: pts.cells } : {}) } : {}),
        name,
        cats, vals, ...(catLevels ? { catLevels } : {}), ...(val.format && !/^general$/i.test(val.format) ? { valFmt: val.format } : {}),
        xs: rules.xy ? cats.map((_c, i) => { const v = Number(cat.pts.get(i)); return cat.pts.has(i) && !isNaN(v) ? v : i + 1; }) : undefined,
        ...(child(s, 'c:bubbleSize') ? { sizes: sizesOf(child(s, 'c:bubbleSize'), n), bubble3D: attr(child(s, 'c:bubble3D'), 'val') === '1' } : {}),
        fill: fill?.kind === 'solid' ? fill.color : fill?.kind === 'none' ? undefined : fill?.kind === 'grad' && fill.stops.length ? fill.stops[0].color : fill?.kind === 'pattern' ? fill.fg : accent,
        ...(fill?.kind === 'grad' && fill.stops.length && !fill.path ? { grad: { stops: fill.stops, angle: fill.angle } } : {}),
        ...(pointGrads.size ? { pointGrads } : {}),
        ...(fill?.kind === 'pattern' ? { patt: { prst: fill.prst, fg: fill.fg, bg: fill.bg } } : {}),
        ...(pointPatts.size ? { pointPatts } : {}),
        ...(pointLines.size ? { pointLines } : {}),
        // 线条写了"无线条"（散点图只画点）时不画线
        line: child(child(spPr, 'a:ln'), 'a:noFill') ? undefined : line ?? (hasLine ? { color: accent, width: 2.25 * 96 / 72, cap: 'round', join: 'round' } : undefined),
        ...(child(child(spPr, 'a:ln'), 'a:noFill') ? { noLine: true } : {}),
        marker,
        smooth: attr(child(s, 'c:smooth'), 'val') === '1',
        markerSymbol: symbol && symbol !== 'none' && symbol !== 'auto' ? symbol : 'circle',
        markerSize: (numAttr(child(mk, 'c:size'), 'val') ?? 5) * 96 / 72,
        markerFill: mkFill?.kind === 'solid' ? mkFill.color : mkFill?.kind === 'none' ? undefined : accent,
        markerLine: mkLine ? mkLine.color : accent,
        pointFills,
        explosion: (i: number) => explode.get(i) ?? serExplode,
        trendlines: readTrendlines(s, name, line?.color ?? (fill?.kind === 'solid' ? fill.color : accent), colors, part, zh),
        errBars: readErrBars(s, colors, part),
      };
    });
    const axIds = children(p, 'c:axId').map((a) => attr(a, 'val') ?? '');
    plots.push({
      kind,
      axIds,
      catReversed: axisReversed(axesOf(plotArea).catAxes.find((a) => axIds.includes(axId(a)))),
      is3D: local.includes('3D'),
      radarStyle: attr(child(p, 'c:radarStyle'), 'val') ?? 'marker',
      horizontal: attr(child(p, 'c:barDir'), 'val') === 'bar',
      grouping: attr(child(p, 'c:grouping'), 'val') ?? type.defaultGrouping ?? 'standard',
      gapWidth: numAttr(child(p, 'c:gapWidth'), 'val') ?? 150,
      gapDepth: numAttr(child(p, 'c:gapDepth'), 'val') ?? 150,
      overlap: numAttr(child(p, 'c:overlap'), 'val') ?? 0,
      holeSize: numAttr(child(p, 'c:holeSize'), 'val') ?? 50,
      firstSliceAng: numAttr(child(p, 'c:firstSliceAng'), 'val') ?? 0,
      varyColors: attr(child(p, 'c:varyColors'), 'val') === '1',
      bubbleScale: numAttr(child(p, 'c:bubbleScale'), 'val') ?? 100,
      sizeRepresents: attr(child(p, 'c:sizeRepresents'), 'val') ?? 'area',
      // 高低点连线、涨跌柱（股价图，折线图也可以开）和垂直线（折线图）
      ...((local === 'stockChart' || local === 'lineChart') && (child(p, 'c:hiLowLines') || child(p, 'c:upDownBars') || child(p, 'c:dropLines')) ? {
        stock: {
          hiLow: child(p, 'c:hiLowLines') ? parseLine([child(child(child(p, 'c:hiLowLines'), 'c:spPr'), 'a:ln')], [colors], part) ?? { color: { r: 64, g: 64, b: 64, a: 1 }, width: 1, cap: 'butt', join: 'round' } : undefined,
          drop: child(p, 'c:dropLines') ? parseLine([child(child(child(p, 'c:dropLines'), 'c:spPr'), 'a:ln')], [colors], part) ?? { color: { r: 166, g: 166, b: 166, a: 1 }, width: 1, cap: 'butt', join: 'round' } : undefined,
          ...(child(p, 'c:upDownBars') ? {
            upDown: {
              gap: numAttr(child(child(p, 'c:upDownBars'), 'c:gapWidth'), 'val') ?? 150,
              up: solidOf(child(child(child(p, 'c:upDownBars'), 'c:upBars'), 'c:spPr'), colors, part),
              down: solidOf(child(child(child(p, 'c:upDownBars'), 'c:downBars'), 'c:spPr'), colors, part),
              line: parseLine([child(child(child(child(p, 'c:upDownBars'), 'c:upBars'), 'c:spPr'), 'a:ln')], [colors], part)?.color,
            },
          } : {}),
        },
      } : {}),
      ...(local === 'ofPieChart' ? {
        ofPie: {
          type: attr(child(p, 'c:ofPieType'), 'val') ?? 'pie',
          splitType: attr(child(p, 'c:splitType'), 'val') ?? 'auto',
          splitPos: numAttr(child(p, 'c:splitPos'), 'val') ?? 0,
          custom: children(child(p, 'c:custSplit'), 'c:secondPiePt').map((e) => numAttr(e, 'val') ?? -1),
          second: numAttr(child(p, 'c:secondPieSize'), 'val') ?? 75,
          gap: numAttr(child(p, 'c:gapWidth'), 'val') ?? 150,
          lines: parseLine([child(child(child(p, 'c:serLines'), 'c:spPr'), 'a:ln')], [colors], part),
        },
      } : {}),
      series,
    });
  }
  return plots;
}
