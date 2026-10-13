/** 从 c:plotArea 读出所有图（plot）和系列 */
import { colorIn, type ColorContext, type Rgba } from '../model/color';
import { findFillEl, parseFill } from '../style/fill';
import { parseLine } from '../style/line';
import { attr, child, children, findAll, numAttr, type XEl } from '../io/xml';
import { ACCENTS, textStyle } from './draw';
import { cacheValues, formatNumber } from './format';
import { chartTypeOfTag } from './chart-types';
import { axesOf, axId, axisReversed } from './axis';
import { readErrBars } from './error-bars';
import { readTrendlines } from './trendline';
import type { Labels, Plot, Series, TextStyle } from './model';

export function readLabels(d: XEl | undefined, base: Labels | undefined, colors: ColorContext, text: TextStyle): Labels | undefined {
  if (!d) return base;
  if (attr(child(d, 'c:delete'), 'val') === '1') return undefined;
  const flag = (n: string, def: boolean) => { const v = attr(child(d, `c:${n}`), 'val'); return v === undefined ? def : v === '1'; };
  const l: Labels = {
    val: flag('showVal', base?.val ?? false), pct: flag('showPercent', base?.pct ?? false),
    cat: flag('showCatName', base?.cat ?? false), ser: flag('showSerName', base?.ser ?? false),
    pos: attr(child(d, 'c:dLblPos'), 'val') ?? base?.pos,
    fmt: attr(child(d, 'c:numFmt'), 'formatCode') ?? base?.fmt,
    style: textStyle(child(d, 'c:txPr'), colors, base?.style ?? text),
  };
  return l.val || l.pct || l.cat || l.ser ? l : undefined;
}

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
    const series: Series[] = children(p, 'c:ser').map((s) => {
      const idx = numAttr(child(s, 'c:idx'), 'val') ?? serialIdx;
      const index = serialIdx++;
      const spPr = child(s, 'c:spPr');
      const fill = parseFill(findFillEl(spPr), colors, part);
      const accent = colorIn({ name: 'x', attrs: {}, text: '', children: [{ name: 'a:schemeClr', attrs: { val: ACCENTS[idx % 6] }, children: [], text: '' }] }, colors)!;
      const line = parseLine([child(spPr, 'a:ln')], [colors], part);
      const cat = cacheValues(child(s, rules.xy ? 'c:xVal' : 'c:cat'));
      const val = cacheValues(child(s, rules.xy ? 'c:yVal' : 'c:val'));
      const n = Math.max(cat.count, val.count);
      const cats: string[] = [];
      const vals: (number | null)[] = [];
      for (let i = 0; i < n; i++) {
        const c = cat.pts.get(i);
        cats.push(c === undefined ? String(i + 1) : cat.format !== 'General' && c !== '' && !isNaN(Number(c)) ? formatNumber(Number(c), cat.format) : c);
        const v = val.pts.get(i);
        vals.push(v === undefined || v === '' ? null : Number(v));
      }
      const pointFills = new Map<number, Rgba>();
      const explode = new Map<number, number>();
      for (const d of children(s, 'c:dPt')) {
        const at = numAttr(child(d, 'c:idx'), 'val') ?? 0;
        const f = parseFill(findFillEl(child(d, 'c:spPr')), colors, part);
        if (f?.kind === 'solid') pointFills.set(at, f.color);
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
      return {
        index,
        labels: readLabels(child(s, 'c:dLbls'), plotLabels, colors, baseText),
        name,
        cats, vals,
        xs: rules.xy ? cats.map((_c, i) => { const v = Number(cat.pts.get(i)); return cat.pts.has(i) && !isNaN(v) ? v : i + 1; }) : undefined,
        ...(child(s, 'c:bubbleSize') ? { sizes: sizesOf(child(s, 'c:bubbleSize'), n), bubble3D: attr(child(s, 'c:bubble3D'), 'val') === '1' } : {}),
        fill: fill?.kind === 'solid' ? fill.color : fill?.kind === 'none' ? undefined : accent,
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
      radarStyle: attr(child(p, 'c:radarStyle'), 'val') ?? 'marker',
      horizontal: attr(child(p, 'c:barDir'), 'val') === 'bar',
      grouping: attr(child(p, 'c:grouping'), 'val') ?? type.defaultGrouping ?? 'standard',
      gapWidth: numAttr(child(p, 'c:gapWidth'), 'val') ?? 150,
      overlap: numAttr(child(p, 'c:overlap'), 'val') ?? 0,
      holeSize: numAttr(child(p, 'c:holeSize'), 'val') ?? 50,
      firstSliceAng: numAttr(child(p, 'c:firstSliceAng'), 'val') ?? 0,
      varyColors: attr(child(p, 'c:varyColors'), 'val') === '1',
      bubbleScale: numAttr(child(p, 'c:bubbleScale'), 'val') ?? 100,
      sizeRepresents: attr(child(p, 'c:sizeRepresents'), 'val') ?? 'area',
      ...(local === 'stockChart' ? {
        stock: {
          hiLow: child(p, 'c:hiLowLines') ? parseLine([child(child(child(p, 'c:hiLowLines'), 'c:spPr'), 'a:ln')], [colors], part) ?? { color: { r: 64, g: 64, b: 64, a: 1 }, width: 1, cap: 'butt', join: 'round' } : undefined,
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
