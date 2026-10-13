/** 从 c:plotArea 读出所有图（plot）和系列 */
import { colorIn, type ColorContext, type Rgba } from '../model/color';
import { findFillEl, parseFill } from '../style/fill';
import { parseLine } from '../style/line';
import { attr, child, children, findAll, numAttr, type XEl } from '../io/xml';
import { ACCENTS, textStyle } from './draw';
import { cacheValues, formatNumber } from './format';
import { chartTypeOfTag } from './chart-types';
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

export function readPlots(plotArea: XEl | undefined, colors: ColorContext, part: string, baseText: TextStyle, warn: (m: string) => void): Plot[] {
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
      for (const d of children(s, 'c:dPt')) {
        const f = parseFill(findFillEl(child(d, 'c:spPr')), colors, part);
        if (f?.kind === 'solid') pointFills.set(numAttr(child(d, 'c:idx'), 'val') ?? 0, f.color);
      }
      const mk = child(s, 'c:marker');
      const symbol = attr(child(mk, 'c:symbol'), 'val');
      const hasLine = rules.defaultLine;
      const mkFill = parseFill(findFillEl(child(mk, 'c:spPr')), colors, part);
      const mkLine = parseLine([child(child(mk, 'c:spPr'), 'a:ln')], [colors], part);
      const marker = rules.marker(symbol);
      return {
        index,
        labels: readLabels(child(s, 'c:dLbls'), plotLabels, colors, baseText),
        name: findAll(child(s, 'c:tx'), 'c:v')[0]?.text ?? child(child(s, 'c:tx'), 'c:v')?.text ?? `系列 ${idx + 1}`,
        cats, vals,
        xs: rules.xy ? cats.map((_c, i) => { const v = Number(cat.pts.get(i)); return cat.pts.has(i) && !isNaN(v) ? v : i + 1; }) : undefined,
        fill: fill?.kind === 'solid' ? fill.color : fill?.kind === 'none' ? undefined : accent,
        // 线条写了"无线条"（散点图只画点）时不画线
        line: child(child(spPr, 'a:ln'), 'a:noFill') ? undefined : line ?? (hasLine ? { color: accent, width: 2.25 * 96 / 72, cap: 'round', join: 'round' } : undefined),
        marker,
        markerSymbol: symbol && symbol !== 'none' && symbol !== 'auto' ? symbol : 'circle',
        markerSize: (numAttr(child(mk, 'c:size'), 'val') ?? 5) * 96 / 72,
        markerFill: mkFill?.kind === 'solid' ? mkFill.color : mkFill?.kind === 'none' ? undefined : accent,
        markerLine: mkLine ? mkLine.color : accent,
        pointFills,
      };
    });
    plots.push({
      kind,
      axIds: children(p, 'c:axId').map((a) => attr(a, 'val') ?? ''),
      radarStyle: attr(child(p, 'c:radarStyle'), 'val') ?? 'marker',
      horizontal: attr(child(p, 'c:barDir'), 'val') === 'bar',
      grouping: attr(child(p, 'c:grouping'), 'val') ?? type.defaultGrouping ?? 'standard',
      gapWidth: numAttr(child(p, 'c:gapWidth'), 'val') ?? 150,
      overlap: numAttr(child(p, 'c:overlap'), 'val') ?? 0,
      holeSize: numAttr(child(p, 'c:holeSize'), 'val') ?? 50,
      firstSliceAng: numAttr(child(p, 'c:firstSliceAng'), 'val') ?? 0,
      varyColors: attr(child(p, 'c:varyColors'), 'val') === '1',
      series,
    });
  }
  return plots;
}
