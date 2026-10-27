/**
 * 整页图里的预设图案填充（style/pattern.ts 的 8×8 点阵：一个点 = 1 个用户单位，前景路径带 shape-rendering="crispEdges"）改成抗锯齿画：
 * 整页图每磅 1 像素，是播放器（一个点正好 1 像素）的 0.75 倍，一个点只有 0.75 像素宽。不抗锯齿时每个点按像素中心取舍——
 * 8 个点落到 6 个像素上，每行每列丢 2 个、其余的占满整个像素：稀疏的点阵（5%、10% 等）比 PowerPoint 深一截、对比强，
 * 斜线类出摩尔纹。抗锯齿按覆盖面积画，等于把一个点 1 像素的样子按面积缩小，颜色深浅和 PowerPoint 的图缩小后一致。
 * 只改整页图；播放器原样保留 crispEdges。
 */

/** pattern.ts 生成的预设图案：底色矩形 + 前景路径（格式改了要同步改这里，paint 的单元测试会报出来） */
const PRESET = /(<pattern id="[^"]+" patternUnits="userSpaceOnUse" x="[^"]*" y="[^"]*" width="8" height="8"><rect width="8" height="8"[^>]*\/><path d="[^"]*"[^>]*?) shape-rendering="crispEdges"(\/><\/pattern>)/g;

export function smoothPatterns(svg: string): string {
  return svg.includes('crispEdges') ? svg.replace(PRESET, '$1$2') : svg;
}
