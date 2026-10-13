/**
 * 扩展点：图表类型。加一种：新建 types/xxx.ts 导出一个 ChartType，在 chart-types.ts 里加一行。
 *   - layout 'standalone'：自己占满绘图区（饼、雷达、散点），实现 render；
 *   - layout 'category'：画在共享的分类轴上，可以和其它 category 类型组合（柱 + 折线），实现 renderOnAxes。
 * 标题、图例、绘图区布局、分类轴和数值轴（含次坐标轴）由 chart.ts 统一处理。
 */
import type { Rgba } from '../model/color';
import type { XEl } from '../io/xml';
import type { AxisInfo, ChartContext, Plot, Rect, Series } from './model';
import type { PixelGrid } from './pixel-grid';

/** 读系列时和类型有关的规则 */
export interface SeriesRules {
  /** 数据在 c:xVal / c:yVal（散点）而不是 c:cat / c:val */
  xy: boolean;
  /** 系列没写线条时是否画默认线条 */
  defaultLine: boolean;
  /** 按 c:marker/c:symbol 决定是否画数据点标记 */
  marker(symbol: string | undefined): boolean;
}

/** 分类轴图共用的绘图区信息 */
export interface CategoryFrame {
  left: number; top: number; right: number; bottom: number;
  pw: number; ph: number;
  /** 每个分类占的宽度，以及第 i 个分类的中心位置（相对 left / bottom） */
  band: number;
  catCenter: (i: number) => number;
  nCat: number;
  /** 条形图（分类轴在左边） */
  horizontal: boolean;
  /** 分类方向上离第一个分类起点 d 像素处的坐标（柱形图是 x，条形图是 y；分类轴逆序时从另一头算） */
  catPx(d: number): number;
  /** 分类方向上从 d 开始、长 len 的一段：返回 [较小一端的坐标, 长度] */
  catSpan(d: number, len: number): [number, number];
  /** 数值位置（0~1，AxisInfo.pos 的结果）在数值方向上的坐标（柱形图是 y，条形图是 x） */
  valPx(f: number): number;
  /** 整像素对齐（柱子的边用） */
  snap: PixelGrid;
}

export interface ChartType {
  /** 写进 Plot.kind 的类型名 */
  readonly kind: string;
  /** c:plotArea 下对应的元素名（不带 c: 前缀） */
  readonly tags: readonly string[];
  readonly layout: 'standalone' | 'category';
  /** 有坐标轴（标题下方要多留空） */
  readonly hasAxes: boolean;
  /** 图例按分类（每个扇区一项）列出，而不是按系列 */
  readonly legendByCategory: boolean;
  /** 没写 c:grouping 时的默认分组（不写就是 standard） */
  readonly defaultGrouping?: string;
  /** 分类轴在左边、数值轴在下面（条形图） */
  horizontal?(plot: Plot): boolean;
  /** 图例倒序（条形图从下往上画） */
  legendReversed?(plot: Plot): boolean;
  seriesRules(plotEl: XEl, tag: string): SeriesRules;
  /** 图例里这个系列的颜色、是否画成线 */
  legendKey(plot: Plot, s: Series): { color?: Rgba; line: boolean; dot?: boolean; none?: boolean };
  /** standalone 类型：在绘图区里画出整个图 */
  render?(plot: Plot, area: Rect, ctx: ChartContext): string;
  /** category 类型：按给定的数值轴画系列；图形加到 out，数据标签加到 labelsOut（最后统一盖在上面） */
  renderOnAxes?(plot: Plot, frame: CategoryFrame, axis: AxisInfo, out: string[], labelsOut: string[]): void;
}
