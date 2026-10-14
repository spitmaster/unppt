/**
 * 坐标轴标签、图例的位置：按 PowerPoint 实测（9、12、20、28 磅四种字号拟合），都随字号成比例。
 * s 是标签字号（像素）。见 SPEC 第 7 节。
 */

/** 文字宽度（像素）：有字体文件时用真实字宽，没有时估算 */
export type TextWidth = (s: string, size: number) => number;

/** 图表区四周留白 */
export const PAD = 11 * 96 / 72;
/** 底部没有图例时下边的留白（约 6 磅） */
export const BOTTOM_PAD = 8;
/** 左右两侧有坐标轴标签时，图表边到标签的距离（不随字号变） */
export const SIDE_LABEL_PAD = 8.6;
/** 竖着排的标签（数值轴在左、条形图分类轴）：留给标签右端到绘图区的间隙 */
export const sideGap = (s: number) => 0.8 * s;
/** 标签右端的对齐点：实测的间隙量的是字的墨迹，字宽右侧本身还有约 1.5 像素空白 */
export const sideAnchor = (s: number) => 0.8 * s - 1.5;
/** 底部横轴标签占的高度、标签中心到轴的距离：分类标签（字带中文）和数值标签不同 */
export const catBand = (s: number) => 1.75 * s + 3;
export const catCenter = (s: number) => 1.21 * s;
export const valBand = (s: number) => 1.4375 * s + 3;
/** 数值标签（和不带中文的分类标签）中心离轴：9、12、20、28 磅导出图的文字行逐行拟合（以前 1.02s，12 磅时高 1 像素） */
export const valCenter = (s: number) => 1.1 * s - 0.75;
/** 底部图例：占的高度、中心到底部留白线的距离（高度按 COM 读 9~28 磅的绘图区下沿校准到 0.05 像素；中心按 9、12、20、28 磅导出图的文字行拟合，12、20 磅逐行吻合，9、28 磅差 1 像素） */
export const legendBand = (s: number) => 1.1763 * s + 6.984;
/** 平面饼图下方图例占的高度（饼没有坐标轴标签，图例上面多留一点；COM 读 9~20 磅饼图外接正方形的下沿） */
export const pieLegendBand = (s: number) => 1.036 * s + 15.9;
export const legendCenter = (s: number) => 0.558 * s - 3.36;
/** 竖轴最上面的标签以网格线为中心，上边至少要留出半个标签（COM 读 9~20 磅的绘图区上沿：图表区 4 磅 + 0.521 × 字号 + 1 磅） */
export const topForLabel = (s: number) => 0.521 * s + 6.66;
/** 横向数值轴最右边的标签以网格线为中心，右边留出半个标签再加 11 磅（COM 读 9~28 磅的绘图区右沿） */
export const RIGHT_LABEL_PAD = PAD;

/**
 * 图例键：色块边长 0.48 × 字号；键到文字的空隙（线条键约 1 像素，色块 0.2 × 字号，横排竖排一样）。
 * 横排图例（上、下）：项与项之间的间隔（色块：0.29 × 字号 + 0.15 × 平均每项宽（键 + 空隙 + 文字），同一个图例里各项间隔相同——
 * COM 生成 6 组不同长度中英文名称的图例量出来，误差 ≤ 1 像素；"系列 N"时约 0.82 × 字号；线条 7.8 + 0.436 × 字号），
 * 第一个键左边留空（色块 0.24 × 字号，线条 3.2 像素）后整体居中。
 * COM 生成 9~28 磅的折线、柱形图图例，导出图上键的位置实测（每项间距、起点误差 ≤ 1 像素）
 */
export const legendSquare = (s: number) => 0.48 * s;
export const legendKeyGap = (s: number, line: boolean) => (line ? 1 : 0.2 * s);
export const legendItemGap = (s: number, line: boolean, avgItem: number) => (line ? 7.8 + 0.436 * s : 0.29 * s + 0.15 * avgItem);
export const legendLead = (s: number, line: boolean) => (line ? 3.2 : 0.24 * s);
/** 图例里有线条项（折线、趋势线）时所有图例键统一的宽度：固定 21 磅，不随字号变（COM 生成 9~20 磅的横排、竖排图例，导出图实测） */
export const LEGEND_LINE_KEY = 28;
/** 竖排图例（左、右）：每行的高度（COM 读 3 种字号：1.03 × 字号 + 6 磅）、图例和绘图区之间的距离（导出图实测，像素） */
export const legendRow = (s: number) => 1.03 * s + 8;
/** 上方图例：中心离图表上边的距离、图例连同下方留白占的高度（像素；高度的常数项按 12 磅 COM 读的绘图区上沿校准） */
export const legendTopCenter = (s: number) => 12 + 0.515 * s;
export const legendTopBand = (s: number) => 16.33 + 1.03 * s;
/** 竖排图例（左、右）：图例到绘图区的距离（线条 19，方块 0.19 × 字号 + 17.08；COM 生成 9~20 磅右侧图例，导出图实测，常数项按 12 磅 COM 读的绘图区右沿校准） */
export const legendPlotGap = (s: number, line: boolean) => (line ? 19 : 0.19 * s + 17.08);

/**
 * 雷达图（PowerPoint 实测，COM 读 96 组"尺寸 × 字号 × 分类数 × 标签"的绘图区）：外接圆直径
 * D = min(图表宽 − 2·mx, 可用高 − 2·my)，mx = 最宽分类标签 + 0.26s + 8 磅，my = 1.63s + 7.7 磅（标签带中文；纯数字 1.32s + 7.7 磅）；
 * 可用高是图表高减去上方（或下方）图例占的 1.03s + 8 磅；圆心横向在中线上，纵向在可用范围中点往下 2 磅（COM 读到的绘图区坐标
 * 相对图表区差 4 磅，按导出图对齐过：charts-more 的雷达图圆心、半径误差 ≤ 0.5 像素）。和分类数无关。
 * s 是分类标签字号（像素），返回像素
 */
const PT = 4 / 3;
export const radarMarginX = (labelW: number, s: number) => labelW + 0.26 * s + 8 * PT;
export const radarMarginY = (s: number, cjk: boolean) => (cjk ? 1.63 : 1.32) * s + 7.7 * PT;
export const radarLegendBand = (s: number) => 1.03 * s + 8 * PT;
export const RADAR_DY = 2 * PT;

/**
 * 数值轴上最多放几个刻度标签：len 是轴长、s 是标签字号（同一单位）。竖轴 0.65·len/s + 2.9、横轴 0.26·len/s + 1.9
 * （COM 读 480 组"数据 × 图表大小 × 字号"的自动刻度拟合：竖轴 240/240、横轴 234/240 吻合）
 */
export const maxTickLabels = (len: number, s: number, horizontal: boolean) => (horizontal ? 0.258 * len / s + 0.97 : 0.65 * len / s + 2.9);

/** 数值轴在上面（条形图分类轴逆序）时占的高度（实测 12 磅一个字号，COM 读绘图区上沿校准） */
export const valBandTop = (s: number) => 1.19 * s + 0.25;
/**
 * 坐标轴标签不在这一侧时（数值轴跑到上面、分类标签挨着中间的 0 线），绘图区这一侧仍留约半个字号：
 * 下边 0.5s − 1.1、左边 0.5s + 0.21（实测 12 磅，COM 读绘图区位置校准）
 */
export const emptyBottomPad = (s: number) => 0.5 * s - 1.1;
export const emptyLeftPad = (s: number) => 0.5 * s + 0.21;
/** 显示单位标签（竖排的"千"等，s 是它的字号）：占的宽度、字的中心到图表边的距离、上端到绘图区顶边的距离（实测 14 磅一个字号） */
export const unitBand = (s: number) => 2.0 * s;
export const unitCenter = (s: number) => 1.08 * s;
export const unitTop = (s: number) => 0.3 * s;
