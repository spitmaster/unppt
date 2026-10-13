/** 图例：按系列（或饼图按分类）列出图例项，放在上下左右，返回剩下的绘图空间 */
import type { ColorContext, Rgba } from '../model/color';
import { attr, child, type XEl } from '../io/xml';
import { chartTypeOf } from './chart-types';
import { accentColor, label, legendKey, textStyle } from './draw';
import { LEGEND_LINE_KEY, legendBand, legendCenter, legendItemGap, legendKeyGap, legendLead, legendPlotGap, legendRow, legendSquare, legendTopBand, legendTopCenter, PAD, type TextWidth } from './layout';
import type { Plot, Rect, Series, TextStyle } from './model';
import { dashAttr } from './trendline';

export interface LegendEntry { name: string; color: Rgba; line: boolean; marker: boolean; series?: Series; width?: number; dash?: string; none?: boolean; paint?: string }

/** 每个系列的图例键（按系列顺序；数据表的行首也用它） */
export function seriesEntries(plots: Plot[], colors: ColorContext): LegendEntry[] {
  const entries: LegendEntry[] = [];
  for (const p of plots) {
    const t = chartTypeOf(p.kind)!;
    for (const s of p.series) {
      const k = t.legendKey(p, s);
      // 图例里的线和系列一样粗（实测）
      entries.push({ name: s.name, color: k.color ?? accentColor(0, colors), line: k.line, marker: s.marker || !!k.dot, ...(k.dot ? {} : { series: s }), ...(k.line && s.line ? { width: s.line.width } : {}), ...(k.none ? { none: true } : {}), ...(s.paint && !k.line ? { paint: s.paint } : {}) });
    }
  }
  return entries;
}

/** 图例里的各项（按显示顺序） */
function entriesOf(plots: Plot[], colors: ColorContext): LegendEntry[] {
  const entries: LegendEntry[] = [];
  const type0 = chartTypeOf(plots[0].kind)!;
  if (type0.legendByCategory || (plots[0].varyColors && plots[0].series.length === 1)) {
    const s = plots[0].series[0];
    s?.cats.forEach((c, i) => entries.push({ name: c, color: s.pointFills.get(i) ?? accentColor(i, colors), line: false, marker: false, ...(s.pointPaints?.has(i) ? { paint: s.pointPaints.get(i) } : {}) }));
    return entries;
  }
  entries.push(...seriesEntries(plots, colors));
  if (type0.legendReversed?.(plots[0])) entries.reverse();
  // 趋势线排在所有系列后面
  for (const p of plots) {
    for (const s of p.series) {
      for (const t of s.trendlines) if (t.line.color) entries.push({ name: t.name, color: t.line.color, line: true, marker: false, width: t.line.width, dash: dashAttr(t.line) });
    }
  }
  return entries;
}

/** 画图例（加到 out），返回去掉图例后的区域 */
export function renderLegend(legend: XEl | undefined, plots: Plot[], area: Rect, w: number, colors: ColorContext, baseText: TextStyle, tw: TextWidth, out: string[]): Rect {
  let { left, top, right, bottom } = area;
  if (!legend) return area;
  const legendPos = attr(child(legend, 'c:legendPos'), 'val') ?? 'r';
  const legendText = textStyle(child(legend, 'c:txPr'), colors, baseText);
  const entries = entriesOf(plots, colors);
  const ks = legendText.size * 0.6;
  if (legendPos === 'b' || legendPos === 't') {
    // 实测（9~28 磅）：色块、间隔都随字号变化
    const sz = legendText.size;
    // 有线条项时所有图例键一样宽（方块变成扁条、标记居中，实测）
    const anyLine = entries.some((e) => e.line);
    const keyW = (e: LegendEntry) => (anyLine ? LEGEND_LINE_KEY : e.line ? ks * 3 : legendSquare(sz));
    const kGap = legendKeyGap(sz, anyLine), gap = legendItemGap(sz, anyLine), lead = legendLead(sz, anyLine);
    const parts = entries.map((e) => keyW(e) + kGap + tw(e.name, sz));
    const total = lead + parts.reduce((a, b) => a + b, 0) + gap * Math.max(0, entries.length - 1);
    let x = (w - total) / 2 + lead;
    // 上方图例：中心在 9 磅 + 0.515 倍字号处，下沿（12 磅 + 1.03 倍字号）再往下 11 磅才是绘图区（COM 读 3 种字号，导出图核对）
    const y = legendPos === 'b' ? bottom - legendCenter(sz) : top - PAD + legendTopCenter(sz);
    entries.forEach((e, i) => {
      if (!e.none) out.push(anyLine ? legendKey(e, x, y, legendSquare(sz), keyW(e)) : legendKey(e, x, y, e.line ? ks : legendSquare(sz)));
      out.push(label(e.name, x + keyW(e) + kGap, y, legendText, 'start'));
      x += parts[i] + gap;
    });
    if (legendPos === 'b') bottom -= legendBand(legendText.size);
    else top += legendTopBand(sz);
  } else {
    // 竖排图例（左、右）：键和横排一样（有线条项时所有键等宽），每行 legendRow；整体在上下范围里居中，
    // 右侧图例的文字右端对齐图表留白线（左侧的键左端对齐）；键到文字、键到绘图区的距离见 layout.ts（实测）
    const sz = legendText.size;
    const anyLine = entries.some((e) => e.line);
    const keyW = anyLine ? LEGEND_LINE_KEY : legendSquare(sz);
    const kGap = legendKeyGap(sz, anyLine);
    const lw = keyW + kGap + Math.max(0, ...entries.map((e) => tw(e.name, sz)));
    const row = legendRow(sz);
    const x = legendPos === 'l' ? left : right - lw;
    let y = (top + bottom) / 2 - (entries.length * row) / 2 + row / 2;
    for (const e of entries) {
      if (!e.none) out.push(anyLine ? legendKey(e, x, y, legendSquare(sz), keyW) : legendKey(e, x, y, legendSquare(sz)));
      out.push(label(e.name, x + keyW + kGap, y, legendText, 'start'));
      y += row;
    }
    // 左侧图例和数值标签之间是图表留白（PAD）；右侧图例和绘图区之间 legendPlotGap
    if (legendPos === 'l') left += lw + PAD;
    else right -= lw + legendPlotGap(sz, anyLine);
  }
  return { left, top, right, bottom };
}
