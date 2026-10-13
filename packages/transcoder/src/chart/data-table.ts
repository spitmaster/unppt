/**
 * 图表的数据表（c:dTable，柱形、折线、面积图的绘图区下方）。PowerPoint 实测（COM 生成 9~20 磅、有无图例、柱形和折线的数据表，量导出图上的表格线）：
 *   - 表头一行（分类名，代替分类轴标签）贴着绘图区底边，只占绘图区那几列；下面每个系列一行；
 *     行高 = 1.36 × 字号 + 4.3；表格底边比图例上方（没有图例时是底部留白处）低约 1 像素（COM 读 12 磅的绘图区下沿校准）；
 *   - 左边一列放图例键和系列名：从图表边 22.3 像素处开始，宽 = 键宽 + 系列名宽 + 0.5 × 字号 + 4
 *     （键：色块 0.48 × 字号，线条约 26 像素）；绘图区左边至少让到这一列右边；
 *   - 表格线：外框、横线、竖线可以分别关掉（showOutline / showHorzBorder / showVertBorder），颜色取 c:spPr 的线条；
 *     数值按"常规"格式居中。
 */
import { css, type ColorContext } from '../model/color';
import { parseLine, type Line } from '../style/line';
import { n2 } from '../common/svg';
import { attr, child, type XEl } from '../io/xml';
import { legendKey, label, textStyle } from './draw';
import { formatNumber } from './format';
import { legendSquare, PAD, type TextWidth } from './layout';
import { seriesEntries } from './legend';
import type { Plot, TextStyle } from './model';
import type { PixelGrid } from './pixel-grid';

export interface DataTable {
  horz: boolean; vert: boolean; outline: boolean; keys: boolean;
  line?: Line;
  style: TextStyle;
}

/** 实测常数（像素） */
const TABLE_LEFT = PAD + 7.66;
const LINE_KEY = 26;
export const rowHeight = (s: number) => 1.36 * s + 4.3;
/** 表格底边比留给它的位置低出的距离 */
const TABLE_DROP = 1.04;

export function readDataTable(plotArea: XEl | undefined, colors: ColorContext, baseText: TextStyle, part: string): DataTable | undefined {
  const dt = child(plotArea, 'c:dTable');
  if (!dt) return undefined;
  const on = (n: string) => attr(child(dt, `c:${n}`), 'val') !== '0';
  return {
    horz: on('showHorzBorder'), vert: on('showVertBorder'), outline: on('showOutline'), keys: on('showKeys'),
    line: parseLine([child(child(dt, 'c:spPr'), 'a:ln')], [colors], part),
    style: textStyle(child(dt, 'c:txPr'), colors, baseText),
  };
}

/** 表格占的尺寸：行高、左列右边（图表坐标）、总高度、绘图区下边要让出的高度 */
export function dataTableSize(dt: DataTable, plots: Plot[], colors: ColorContext, tw: TextWidth): { rowH: number; colRight: number; height: number; reserve: number } {
  const s = dt.style.size;
  const entries = seriesEntries(plots, colors);
  const anyLine = entries.some((e) => e.line);
  const keyW = dt.keys ? (anyLine ? LINE_KEY : legendSquare(s)) : 0;
  const nameW = Math.max(0, ...entries.map((e) => tw(e.name, s)));
  const rowH = rowHeight(s);
  const height = rowH * (entries.length + 1);
  return { rowH, colRight: TABLE_LEFT + keyW + nameW + 0.5 * s + 4, height, reserve: height - TABLE_DROP };
}

/** 画数据表：top 是绘图区底边（表头上沿），left/right 是绘图区左右，band 是每个分类的宽度 */
export function renderDataTable(
  dt: DataTable, plots: Plot[], cats: string[], colors: ColorContext, tw: TextWidth,
  top: number, left: number, right: number, band: number, g: PixelGrid, out: string[],
): void {
  const s = dt.style.size;
  const entries = seriesEntries(plots, colors);
  const series = plots.flatMap((p) => p.series);
  const { rowH } = dataTableSize(dt, plots, colors, tw);
  const bottom = top + rowH * (entries.length + 1);
  const rowsTop = top + rowH;
  // 文字：表头的分类名、每行的系列名和数值
  cats.forEach((c, i) => out.push(label(c, left + (i + 0.5) * band, top + rowH / 2, dt.style)));
  const anyLine = entries.some((e) => e.line);
  const keyW = dt.keys ? (anyLine ? LINE_KEY : legendSquare(s)) : 0;
  entries.forEach((e, k) => {
    const y = rowsTop + (k + 0.5) * rowH;
    // 左列：从左边 0.29 × 字号处放键，键和名字之间 0.24 × 字号（实测 12 磅时 4.7、3.9 像素）
    const kx = TABLE_LEFT + 0.29 * s;
    if (dt.keys && !e.none) out.push(anyLine ? legendKey(e, kx, y, legendSquare(s), keyW) : legendKey(e, kx, y, legendSquare(s)));
    out.push(label(e.name, kx + keyW + (dt.keys ? 0.24 * s : 0), y, dt.style, 'start'));
    const vals = series[k]?.vals ?? [];
    cats.forEach((_c, i) => {
      const v = vals[i];
      if (v !== null && v !== undefined) out.push(label(formatNumber(v, 'General'), left + (i + 0.5) * band, y, dt.style));
    });
  });
  // 表格线
  const ln = dt.line;
  if (!ln?.color) return;
  const d: string[] = [];
  // 表格线对齐整像素（pixel-grid.ts）
  const h = (y: number, x0: number, x1: number) => d.push(`M${n2(x0)} ${n2(g.line('y', y, ln.width))}H${n2(x1)}`);
  const v = (x: number, y0: number, y1: number) => d.push(`M${n2(g.line('x', x, ln.width))} ${n2(y0)}V${n2(y1)}`);
  if (dt.horz) {
    h(rowsTop, TABLE_LEFT, right);
    for (let k = 1; k < entries.length; k++) h(rowsTop + k * rowH, TABLE_LEFT, right);
  }
  if (dt.vert) for (let i = 1; i < cats.length; i++) v(left + i * band, top, bottom);
  if (dt.outline) {
    h(top, left, right);
    h(bottom, TABLE_LEFT, right);
    v(TABLE_LEFT, rowsTop, bottom);
    v(left, top, bottom);
    v(right, top, bottom);
  }
  out.push(`<path d="${d.join('')}" fill="none" stroke="${css(ln.color)}" stroke-width="${n2(ln.width)}"/>`);
}
