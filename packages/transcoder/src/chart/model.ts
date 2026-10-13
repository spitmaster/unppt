/** 图表的数据结构：从 chart XML 读出来的图（plot）、系列、数据标签、文字样式、坐标轴刻度 */
import type { ColorContext, Rgba } from '../model/color';
import type { Line } from '../style/line';
import type { XEl } from '../io/xml';

export interface TextStyle { size: number; color: Rgba; bold: boolean; font: string; }

export interface Labels { val: boolean; pct: boolean; cat: boolean; ser: boolean; pos?: string; fmt?: string; style: TextStyle; }

export interface Series {
  labels?: Labels;
  name: string;
  cats: string[];
  vals: (number | null)[];
  /** 散点图的 X 值 */
  xs?: (number | null)[];
  fill?: Rgba;
  line?: Line;
  marker: boolean;
  /** 标记的直径（像素）和颜色 */
  markerSize: number;
  markerFill?: Rgba;
  markerLine?: Rgba;
  pointFills: Map<number, Rgba>;
}

export interface Plot {
  /** 图表类型（ChartType.kind） */
  kind: string;
  /** 这个图用的坐标轴编号（c:axId） */
  axIds: string[];
  radarStyle: string;
  horizontal: boolean;
  grouping: string;
  gapWidth: number;
  overlap: number;
  holeSize: number;
  firstSliceAng: number;
  varyColors: boolean;
  series: Series[];
}

/** 一根数值轴算好的刻度：pos 把数值换成 0~1 的位置 */
export interface AxisInfo { lo: number; hi: number; ticks: number[]; labels: string[]; fmt: string; deleted: boolean; style: TextStyle; grid?: Line; axisLine?: Line; pos: (v: number) => number }

/** 按坐标轴元素和数值范围算刻度 */
export type AxisMaker = (ax: XEl | undefined, vmin: number, vmax: number, pct: boolean) => AxisInfo;

/** 绘图区（像素） */
export interface Rect { left: number; top: number; right: number; bottom: number }

/** 画图时用到的公共环境 */
export interface ChartContext {
  colors: ColorContext;
  part: string;
  baseText: TextStyle;
  plotArea?: XEl;
  makeAxis: AxisMaker;
}
