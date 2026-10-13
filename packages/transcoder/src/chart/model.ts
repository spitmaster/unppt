/** 图表的数据结构：从 chart XML 读出来的图（plot）、系列、数据标签、文字样式、坐标轴刻度 */
import type { ColorContext, Rgba } from '../model/color';
import type { Line } from '../style/line';
import type { XEl } from '../io/xml';

export interface TextStyle { size: number; color: Rgba; bold: boolean; font: string; }

export interface Labels { val: boolean; pct: boolean; cat: boolean; ser: boolean; pos?: string; fmt?: string; style: TextStyle; }

export interface Series {
  /** 在整个图表里的序号（按读到的顺序，多个图叠在一起时连续编号）：按系列动画用 */
  index: number;
  labels?: Labels;
  name: string;
  cats: string[];
  vals: (number | null)[];
  /** 散点图的 X 值 */
  xs?: (number | null)[];
  /** 气泡图的气泡大小；bubble3D 时画成有高光的球 */
  sizes?: (number | null)[];
  bubble3D?: boolean;
  fill?: Rgba;
  line?: Line;
  /** 线条明确设成了"无线条"（折线图不画线，只画标记） */
  noLine?: boolean;
  marker: boolean;
  /** 平滑线（c:smooth） */
  smooth: boolean;
  /** 标记形状：circle、square、diamond、triangle、x、star、dot、dash、plus */
  markerSymbol: string;
  /** 标记的直径（像素）和颜色 */
  markerSize: number;
  markerFill?: Rgba;
  markerLine?: Rgba;
  pointFills: Map<number, Rgba>;
  /** 趋势线、误差线 */
  trendlines: Trendline[];
  errBars: ErrBars[];
  /** 饼图扇区分离：每个数据点离开圆心的距离（半径的百分比；系列上写的对所有点生效） */
  explosion: (i: number) => number;
}

/** 趋势线（拟合和画法见 trendline.ts） */
export interface Trendline {
  type: string;
  /** 多项式的阶数、移动平均的周期 */
  order: number;
  period: number;
  /** 向前、向后延伸（x 的单位） */
  forward: number;
  backward: number;
  /** 指定的截距 */
  intercept?: number;
  line: Line;
  /** 图例里的名字 */
  name: string;
}

/** 误差线（画法见 error-bars.ts） */
export interface ErrBars {
  dir: 'x' | 'y';
  type: string;
  valType: string;
  val: number;
  noEndCap: boolean;
  line: Line;
  /** 自定义误差量（c:plus / c:minus） */
  plus: (number | null)[];
  minus: (number | null)[];
}

/**
 * 三维图表的视图（c:view3D）：俯角、转角、透视（0~240）、直角坐标轴（没有透视）、深度和高度（基底的百分比）；
 * autoScale：没写 hPercent（PowerPoint 只在关闭"自动缩放"时写高度百分比）
 */
export interface View3D { rotX: number; rotY: number; perspective: number; rAngAx: boolean; depthPercent: number; hPercent: number; autoScale: boolean }

export interface Plot {
  /** 图表类型（ChartType.kind） */
  kind: string;
  /** 这个图用的坐标轴编号（c:axId） */
  axIds: string[];
  radarStyle: string;
  horizontal: boolean;
  /** 分类轴逆序（"逆序类别"） */
  catReversed: boolean;
  /** 三维图表（pie3DChart、bar3DChart……） */
  is3D: boolean;
  grouping: string;
  gapWidth: number;
  /** 三维图表：系列之间的间隙深度（%） */
  gapDepth: number;
  overlap: number;
  holeSize: number;
  firstSliceAng: number;
  varyColors: boolean;
  /** 气泡图：气泡大小比例（%）、大小代表面积（area）还是直径（w） */
  bubbleScale: number;
  sizeRepresents: string;
  /** 股价图：最高最低连线、涨跌柱（间隙宽度%、涨柱和跌柱的填充、边框） */
  /** 高低点连线、涨跌柱（股价图，折线图也可以开）、垂直线（折线图） */
  stock?: { hiLow?: Line; drop?: Line; upDown?: { gap: number; up?: Rgba; down?: Rgba; line?: Rgba } };
  /** 空值怎么画（c:dispBlanksAs）：留空、按零、跨过去连线 */
  blanks?: 'gap' | 'zero' | 'span';
  /** 复合饼图、复合条饼图：右图类型、怎么拆（auto / pos / val / percent / cust）、拆分值、右图大小%、间隙宽度%、连接线 */
  ofPie?: { type: string; splitType: string; splitPos: number; custom: number[]; second: number; gap: number; lines?: Line };
  series: Series[];
}

/** 一根数值轴算好的刻度：pos 把数值换成 0~1 的位置（已经算上对数刻度和逆序） */
export interface AxisInfo {
  lo: number; hi: number; ticks: number[]; labels: string[]; fmt: string; deleted: boolean; style: TextStyle;
  grid?: Line; axisLine?: Line;
  /** 次要刻度的数值（有次要网格线或次要刻度线时才算）和次要网格线 */
  minor: number[]; minorGrid?: Line;
  /** 主要、次要刻度线：none / in / out / cross */
  majorMark: string; minorMark: string;
  /** 刻度标签位置：nextTo（挨着坐标轴）/ low / high / none */
  lblPos: string;
  /** 这根轴和另一根轴交叉的位置（c:crosses / c:crossesAt） */
  crosses: 'autoZero' | 'min' | 'max' | number;
  /** 逆序刻度值 */
  reversed: boolean;
  /** 显示单位的标签（例如"千"） */
  unitLabel?: { text: string; style: TextStyle };
  pos: (v: number) => number;
}

/** 算刻度时的附加信息 */
export interface AxisOpts {
  /** 百分比堆积（默认格式 0%） */
  pct?: boolean;
  /** 最大值上方留的余量（默认 5%） */
  margin?: number;
  /** 最小的正数（对数刻度用） */
  minPos?: number;
  /** 轴的长度（像素）和方向：自动刻度的疏密取决于能放下几个标签 */
  length?: number;
  horizontal?: boolean;
}

/** 按坐标轴元素和数值范围算刻度 */
export type AxisMaker = (ax: XEl | undefined, vmin: number, vmax: number, opts?: AxisOpts) => AxisInfo;

/** 绘图区（像素） */
export interface Rect { left: number; top: number; right: number; bottom: number }

/** 画图时用到的公共环境 */
export interface ChartContext {
  colors: ColorContext;
  part: string;
  baseText: TextStyle;
  plotArea?: XEl;
  makeAxis: AxisMaker;
  /** 量文字宽度 */
  width: (s: string, size: number) => number;
  /** 整个图表区的大小 */
  box: { w: number; h: number };
  /** 图例位置（t / b / l / r，没有图例时不写）、有没有标题、绘图区是不是手动布局：雷达图按 PowerPoint 的规则自己排 */
  legendPos?: string;
  hasTitle?: boolean;
  manual?: boolean;
  /** 三维图表的视图 */
  view3D?: View3D;
  defs?: SvgDefs;
}

/** 页面里的 defs：唯一编号、加一条定义 */
export interface SvgDefs { id(kind: string): string; add(xml: string): void }
