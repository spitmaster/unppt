/**
 * 坐标轴标签、图例的位置：按 PowerPoint 实测（9、12、20、28 磅四种字号拟合），都随字号成比例。
 * s 是标签字号（像素）。见 SPEC 第 7 节。
 */

/** 文字宽度（像素）：有字体文件时用真实字宽，没有时估算 */
export type TextWidth = (s: string, size: number) => number;

/** 图表区四周留白 */
export const PAD = 11 * 96 / 72;
/** 左右两侧有坐标轴标签时，图表边到标签的距离（不随字号变） */
export const SIDE_LABEL_PAD = 8.6;
/** 竖着排的标签（数值轴在左、条形图分类轴）：留给标签右端到绘图区的间隙 */
export const sideGap = (s: number) => 0.8 * s;
/** 标签右端的对齐点：实测的间隙量的是字的墨迹，字宽右侧本身还有约 1.5 像素空白 */
export const sideAnchor = (s: number) => 0.8 * s - 1.5;
/** 底部横轴标签占的高度、标签中心到轴的距离：分类标签（字带中文）和数值标签不同 */
export const catBand = (s: number) => 1.75 * s + 3;
export const catCenter = (s: number) => 1.21 * s;
export const valBand = (s: number) => 1.43 * s + 3.7;
export const valCenter = (s: number) => 1.02 * s;
/** 底部图例：占的高度、中心到底部留白线的距离 */
export const legendBand = (s: number) => 1.17 * s + 7.3;
export const legendCenter = (s: number) => 0.41 * s;
/** 竖轴最上面的标签以网格线为中心，上边至少要留出半个标签 */
export const topForLabel = (s: number) => 0.6 * s + 3.5;
/** 横向数值轴最右边的标签以网格线为中心，右边留出半个标签再加一点 */
export const RIGHT_LABEL_PAD = 15.5;
