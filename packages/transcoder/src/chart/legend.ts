/** 图例：按系列（或饼图按分类）列出图例项，放在上下左右，返回剩下的绘图空间 */
import type { ColorContext, Rgba } from '../model/color';
import { attr, child, type XEl } from '../io/xml';
import { chartTypeOf } from './chart-types';
import { accentColor, label, legendKey, textStyle } from './draw';
import { legendBand, legendCenter, legendItemGap, legendKeyGap, legendSquare, type TextWidth } from './layout';
import type { Plot, Rect, Series, TextStyle } from './model';

export interface LegendEntry { name: string; color: Rgba; line: boolean; marker: boolean; series?: Series }

/** 图例里的各项（按显示顺序） */
function entriesOf(plots: Plot[], colors: ColorContext): LegendEntry[] {
  const entries: LegendEntry[] = [];
  const type0 = chartTypeOf(plots[0].kind)!;
  if (type0.legendByCategory || (plots[0].varyColors && plots[0].series.length === 1)) {
    const s = plots[0].series[0];
    s?.cats.forEach((c, i) => entries.push({ name: c, color: s.pointFills.get(i) ?? accentColor(i, colors), line: false, marker: false }));
    return entries;
  }
  for (const p of plots) {
    const t = chartTypeOf(p.kind)!;
    for (const s of p.series) {
      const k = t.legendKey(p, s);
      entries.push({ name: s.name, color: k.color ?? accentColor(0, colors), line: k.line, marker: s.marker || !!k.dot, ...(k.dot ? {} : { series: s }) });
    }
  }
  if (type0.legendReversed?.(plots[0])) entries.reverse();
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
  const itemW = entries.map((e) => (e.line ? ks * 3 : ks) + 4 + tw(e.name, legendText.size) + 10);
  if (legendPos === 'b' || legendPos === 't') {
    // 实测（9~28 磅）：色块、间隔都随字号变化
    const sz = legendText.size;
    const keyW = (e: LegendEntry) => (e.line ? ks * 3 : legendSquare(sz));
    const parts = entries.map((e) => keyW(e) + legendKeyGap(sz) + tw(e.name, sz));
    const total = parts.reduce((a, b) => a + b, 0) + legendItemGap(sz) * Math.max(0, entries.length - 1);
    let x = (w - total) / 2;
    const y = legendPos === 'b' ? bottom - legendCenter(sz) : top + sz * 0.6;
    entries.forEach((e, i) => {
      out.push(legendKey(e, x, y, e.line ? ks : legendSquare(sz)));
      out.push(label(e.name, x + keyW(e) + legendKeyGap(sz), y, legendText, 'start'));
      x += parts[i] + legendItemGap(sz);
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
  return { left, top, right, bottom };
}
