/** 图例：按系列（或饼图按分类）列出图例项，放在上下左右，返回剩下的绘图空间 */
import type { ColorContext, Rgba } from '../model/color';
import { attr, child, numAttr, type XEl } from '../io/xml';
import { chartTypeOf } from './chart-types';
import { accentColor, label, legendKey, strokeOf, textStyle } from './draw';
import { LEGEND_LINE_KEY, legendBand, legendCenter, legendItemGap, legendKeyGap, legendLead, legendPlotGap, legendRow, legendSquare, legendTopBand, legendTopCenter, PAD, type TextWidth } from './layout';
import type { Plot, Rect, Series, TextStyle } from './model';
import { dashAttr } from './trendline';

export interface LegendEntry { name: string; color: Rgba; line: boolean; marker: boolean; series?: Series; width?: number; dash?: string; none?: boolean; paint?: string; stroke?: string }

/** 每个系列的图例键（按系列顺序；数据表的行首也用它） */
export function seriesEntries(plots: Plot[], colors: ColorContext): LegendEntry[] {
  const entries: LegendEntry[] = [];
  for (const p of plots) {
    const t = chartTypeOf(p.kind)!;
    for (const s of p.series) {
      const k = t.legendKey(p, s);
      // 图例里的线和系列一样粗（实测）
      entries.push({ name: s.name, color: k.color ?? accentColor(0, colors), line: k.line, marker: s.marker || !!k.dot, ...(k.dot ? {} : { series: s }), ...(k.line && s.line ? { width: s.line.width } : {}), ...(k.none ? { none: true } : {}), ...(s.paint && !k.line ? { paint: s.paint } : {}), ...(!k.line && !k.dot ? { stroke: strokeOf(s, -1) } : {}) });
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
    s?.cats.forEach((c, i) => entries.push({ name: c, color: s.pointFills.get(i) ?? accentColor(i, colors), line: false, marker: false, ...(s.pointPaints?.has(i) ? { paint: s.pointPaints.get(i) } : {}), stroke: strokeOf(s, i) }));
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

/**
 * 画图例（加到 out），返回去掉图例后的区域；drawTop 是摆图例用的上沿（标题下面，不给时用 area.top），h 是图表高（手动摆放的图例要用）。
 * 手动摆放的图例（c:layout 的 manualLayout，样本里近一半的图例）：实测（charts-legend-manual）绘图区照样按 legendPos 那一侧
 * 让出自动图例的位置，图例本身画在手动的框里（manualBox）
 */
export function renderLegend(legend: XEl | undefined, plots: Plot[], area: Rect, w: number, colors: ColorContext, baseText: TextStyle, tw: TextWidth, out: string[], drawTop?: number, hasAxes = true, bandOf = legendBand, h?: number): Rect {
  const box = manualBox(legend, w, h);
  if (!box) return autoLegend(legend, plots, area, w, colors, baseText, tw, out, drawTop, hasAxes, bandOf);
  const rest = autoLegend(legend, plots, area, w, colors, baseText, tw, [], drawTop, hasAxes, bandOf);
  manualLegend(entriesOf(plots, colors), box, textStyle(child(legend, 'c:txPr'), colors, baseText), tw, out);
  return rest;
}

/** 图例的手动位置（图表坐标）：只认 x、y 按图表边算（edge）、宽高按图表比例的写法，其它按自动 */
function manualBox(legend: XEl | undefined, w: number, h: number | undefined): Rect | undefined {
  const ml = child(child(legend, 'c:layout'), 'c:manualLayout');
  if (!ml || !h) return undefined;
  const x = numAttr(child(ml, 'c:x'), 'val'), y = numAttr(child(ml, 'c:y'), 'val'), bw = numAttr(child(ml, 'c:w'), 'val'), bh = numAttr(child(ml, 'c:h'), 'val');
  const edge = (k: string) => attr(child(ml, k), 'val') === 'edge';
  if (x === undefined || y === undefined || !bw || !bh || !edge('c:xMode') || !edge('c:yMode')) return undefined;
  return { left: x * w, top: y * h, right: (x + bw) * w, bottom: (y + bh) * h };
}

/**
 * 手动框里的图例（实测 charts-legend-manual，框四边和各项位置误差 1~2 像素）：各项排成网格，格宽是最宽的一项（键 + 间隔 + 名字）；
 * 列数是框宽里放得下的最多格数（至少 1），每行的格子之间、和框两边的空隙都相等；后面的行用同样的列；框高按行数等分，每行在自己那一格的中间
 */
function manualLegend(entries: LegendEntry[], box: Rect, st: TextStyle, tw: TextWidth, out: string[]): void {
  if (!entries.length) return;
  const sz = st.size, ks = sz * 0.6;
  const anyLine = entries.some((e) => e.line);
  const keyW = (e: LegendEntry) => (anyLine ? LEGEND_LINE_KEY : e.line ? ks * 3 : legendSquare(sz));
  const kGap = legendKeyGap(sz, anyLine);
  const cell = Math.max(...entries.map((e) => keyW(e) + kGap + tw(e.name, sz, st.font)));
  const bw = box.right - box.left;
  const cols = Math.max(1, Math.min(entries.length, Math.floor(bw / cell)));
  const rows = Math.ceil(entries.length / cols);
  const gap = (bw - cols * cell) / (cols + 1);
  const rowH = (box.bottom - box.top) / rows;
  entries.forEach((e, i) => {
    const x = box.left + gap + (i % cols) * (cell + gap), y = box.top + (Math.floor(i / cols) + 0.5) * rowH;
    if (!e.none) out.push(anyLine ? legendKey(e, x, y, legendSquare(sz), keyW(e)) : legendKey(e, x, y, e.line ? ks : legendSquare(sz)));
    out.push(label(e.name, x + keyW(e) + kGap, y, st, 'start'));
  });
}

function autoLegend(legend: XEl | undefined, plots: Plot[], area: Rect, w: number, colors: ColorContext, baseText: TextStyle, tw: TextWidth, out: string[], drawTop?: number, hasAxes = true, bandOf = legendBand): Rect {
  let { left, top, right, bottom } = area;
  const shift = (drawTop ?? top) - top;
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
    const kGap = legendKeyGap(sz, anyLine), lead = legendLead(sz, anyLine);
    const parts = entries.map((e) => keyW(e) + kGap + tw(e.name, sz, legendText.font));
    const gap = legendItemGap(sz, anyLine, parts.reduce((a, b) => a + b, 0) / Math.max(1, parts.length));
    const total = lead + parts.reduce((a, b) => a + b, 0) + gap * Math.max(0, entries.length - 1);
    let x = (w - total) / 2 + lead;
    // 上方图例：中心在 9 磅 + 0.515 倍字号处，下沿（12 磅 + 1.03 倍字号）再往下 11 磅才是绘图区（COM 读 3 种字号，导出图核对）
    const y = legendPos === 'b' ? bottom - legendCenter(sz) : top + shift - PAD + legendTopCenter(sz);
    entries.forEach((e, i) => {
      if (!e.none) out.push(anyLine ? legendKey(e, x, y, legendSquare(sz), keyW(e)) : legendKey(e, x, y, e.line ? ks : legendSquare(sz)));
      out.push(label(e.name, x + keyW(e) + kGap, y, legendText, 'start'));
      x += parts[i] + gap;
    });
    if (legendPos === 'b') bottom -= bandOf(legendText.size);
    else top += legendTopBand(sz);
  } else {
    // 竖排图例（左、右）：键和横排一样（有线条项时所有键等宽），每行 legendRow；整体在上下范围里居中，
    // 右侧图例的文字右端对齐图表留白线（左侧的键左端对齐）；键到文字、键到绘图区的距离见 layout.ts（实测）
    const sz = legendText.size;
    const anyLine = entries.some((e) => e.line);
    const keyW = anyLine ? LEGEND_LINE_KEY : legendSquare(sz);
    const kGap = legendKeyGap(sz, anyLine);
    const lw = keyW + kGap + Math.max(0, ...entries.map((e) => tw(e.name, sz, legendText.font)));
    const row = legendRow(sz);
    const x = legendPos === 'l' ? left : right - lw;
    let y = (top + shift + bottom) / 2 - (entries.length * row) / 2 + row / 2;
    for (const e of entries) {
      if (!e.none) out.push(anyLine ? legendKey(e, x, y, legendSquare(sz), keyW) : legendKey(e, x, y, legendSquare(sz)));
      out.push(label(e.name, x + keyW + kGap, y, legendText, 'start'));
      y += row;
    }
    // 左侧图例和数值标签之间是图表留白（PAD，COM 读 12 磅时少 0.7 像素）；右侧图例、没有坐标轴的图（饼图）左侧图例和绘图区之间 legendPlotGap
    if (legendPos === 'l') left += lw + (hasAxes ? PAD - 0.7 : legendPlotGap(sz, anyLine));
    else right -= lw + legendPlotGap(sz, anyLine);
  }
  return { left, top, right, bottom };
}
