/**
 * 图表文字的行高随字体变（PowerPoint 实测，COM 读绘图区内框、标题和图例的高：等线 / 微软雅黑 / 宋体 / 黑体 / Arial / Calibri /
 * Times New Roman 搭配 × 9、12、18 磅 × 有无标题、图例，以及纯汉字 / 纯西文 / 混排的标题、图例、分类名）。
 * layout.ts 的带子、chart.ts 的标题都是按等线（Windows 度量：上伸 0.8101 + 下伸 0.2319 = 1.042 em）校准的，这里算换了字体多出来的：
 *   - 一行文字的高：有中日韩字的行是 1.3 × 东亚字体的 em 高（西文字体本身有汉字时用西文字体，例如西文槽也写微软雅黑），
 *     和西文字体的 em 高（1 倍）取大的；纯西文的行是西文字体的 em 高（em 高 = Windows 的上伸 + 下伸）；
 *   - 标题框高 = 字号 × 行高 + 3 磅，标题的上边不动；
 *   - 底部分类标签带 = 字号 × (行高 + 0.668 × 西文字体的上伸) + 常数；
 *   - 下方图例带 = 0.99 × 字号 × 西文字体的 em 高 + 常数（不管名称是不是汉字），图例下边不动；
 *   - 竖轴最上面的数值标签：绘图区上边留半个 字号 × 西文字体的 em 高。
 */
import { hasCjk } from './draw';
import type { TextWidth } from './layout';
import type { TextStyle } from './model';

/** 校准用的等线：em 高、上伸 */
const BASE_EM = 1.042, BASE_ASC = 0.8101;
/** 有汉字的行比 em 高多出的倍数（实测） */
const CJK_LINE = 1.3;
/** 分类标签带里西文字体上伸的系数、图例带的系数（实测） */
const CAT_ASC = 0.668, LEGEND_LINE = 0.99;

const emOf = (m: { ascent: number; descent: number }) => m.ascent + m.descent;

/** 西文字体、汉字实际用的字体的度量（不知道时 undefined：按校准的等线算，不调整） */
function fontsOf(st: TextStyle, tw: TextWidth) {
  const latin = tw.vm?.(st.font, false);
  const ea0 = tw.vm?.(st.eaFont, true);
  return { latin, ea: latin?.cjk ? latin : ea0 };
}

/** 一行文字的高（em）；cjk 是这行有没有中日韩字 */
function lineEm(st: TextStyle, cjk: boolean, tw: TextWidth): number | undefined {
  const { latin, ea } = fontsOf(st, tw);
  if (!latin) return undefined;
  return cjk && ea ? Math.max(CJK_LINE * emOf(ea), emOf(latin)) : emOf(latin);
}

/**
 * 一行文字比校准时高出多少（像素，可为负）：texts 里有一个带中日韩字就按有汉字的行算。校准时的行默认和这行同类
 * （有汉字的按等线汉字行，纯西文的按等线西文行）；cjkBase 时总是和等线汉字行比（标题只按"图表标题"校准过）
 */
export function lineShift(st: TextStyle, texts: string | string[], tw: TextWidth, cjkBase = false): number {
  const cjk = (Array.isArray(texts) ? texts : [texts]).some(hasCjk);
  const em = lineEm(st, cjk, tw);
  return em === undefined ? 0 : st.size * (em - (cjk || cjkBase ? CJK_LINE * BASE_EM : BASE_EM));
}

/** 一行文字的高是校准时（同类的等线行）的几倍：分类标签放不放得下斜排、竖排，折行的行高按它（cat-labels.ts） */
export function lineFactor(st: TextStyle, texts: string[], tw: TextWidth): number {
  const cjk = texts.some(hasCjk);
  return 1 + lineShift(st, texts, tw) / (st.size * (cjk ? CJK_LINE * BASE_EM : BASE_EM));
}

/** 底部分类标签（或数值标签）带比等线多出的高度 */
export function catBandShift(st: TextStyle, texts: string[], tw: TextWidth): number {
  const latin = tw.vm?.(st.font, false);
  return lineShift(st, texts, tw) + (latin ? CAT_ASC * st.size * (latin.ascent - BASE_ASC) : 0);
}

/** 西文字体 em 高比等线多出的（像素）：数值标签、图例只看西文字体 */
export function latinShift(st: TextStyle, tw: TextWidth): number {
  const latin = tw.vm?.(st.font, false);
  return latin ? st.size * (emOf(latin) - BASE_EM) : 0;
}

/** 下方、上方图例带比等线多出的高度 */
export const legendShift = (st: TextStyle, tw: TextWidth) => LEGEND_LINE * latinShift(st, tw);
