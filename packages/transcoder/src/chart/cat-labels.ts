/**
 * 底部分类标签放不下时怎么办（PowerPoint 实测：COM 生成 4~16 个分类、中文/英文/中英混合标签、9/12/16 磅的柱形图，
 * 读绘图区内框，导出图量标签位置）：
 *   - 每个标签宽 ≤ 分类宽：横排一行；
 *   - 否则，每个标签都能在空格处折成每行 ≤ 分类宽：折行，标签带每多一行高 1.044 × 字号；
 *   - 否则（含没有空格的中文）整体转 −45°：文字（右对齐、居中基线）的锚点在分类中心左 0.02 × 字号、轴下 1.27 × 字号 − 4.2；
 *     标签带高 0.707 × 最宽标签 + 1.54 × 字号；第一个标签伸出分类中心左边 0.707 × 宽 + 0.17 × 字号，
 *     绘图区左边让它的墨迹离图表左边至少 10 像素。
 */
import { n2 } from '../common/svg';
import { label } from './draw';
import type { TextWidth } from './layout';
import type { TextStyle } from './model';

export type CatFit = { kind: 'line' } | { kind: 'wrap'; lines: string[][]; n: number } | { kind: 'rot' };

const SIN45 = Math.SQRT1_2;
/** 实测：折行每多一行的高度、斜标签带的常数项、斜标签末端的位置、第一个斜标签离图表左边的距离（像素，s 是字号） */
const WRAP_LINE = 1.044, ROT_BAND = 1.54, ROT_X = 0.02, ROT_Y = 1.27, ROT_Y0 = 4.2, ROT_LEFT = 0.17, ROT_EDGE = 10;

/** 按空格贪心折行；有一个词比宽度还宽时返回 undefined */
function wrapWords(t: string, width: number, s: number, tw: TextWidth): string[] | undefined {
  const words = t.split(' ').filter((x) => x);
  const lines: string[] = [];
  for (const word of words) {
    if (tw(word, s) > width) return undefined;
    const cur = lines.length ? `${lines[lines.length - 1]} ${word}` : '';
    if (lines.length && tw(cur, s) <= width) lines[lines.length - 1] = cur;
    else lines.push(word);
  }
  return lines;
}

export function fitCategoryLabels(cats: string[], catW: number, s: number, tw: TextWidth): CatFit {
  if (cats.every((c) => tw(c, s) <= catW)) return { kind: 'line' };
  const wrapped = cats.map((c) => (tw(c, s) <= catW ? [c] : wrapWords(c, catW, s, tw)));
  if (wrapped.every((l) => l)) {
    const lines = wrapped as string[][];
    return { kind: 'wrap', lines, n: Math.max(...lines.map((l) => l.length)) };
  }
  return { kind: 'rot' };
}

/** 标签带的高度：横排、折行时在平常的带高 base 上加多出的行，斜排按最宽标签 */
export function catFitBand(fit: CatFit, base: number, cats: string[], s: number, tw: TextWidth): number {
  if (fit.kind === 'wrap') return base + (fit.n - 1) * WRAP_LINE * s;
  if (fit.kind === 'rot') return SIN45 * Math.max(0, ...cats.map((c) => tw(c, s))) + ROT_BAND * s;
  return base;
}

/** 实测：分类在端点上（面积图）转斜时绘图区右边留的空（× 字号，一个样例） */
export const ROT_MIDCAT_RIGHT = 1.05;

/** 斜排时第一个分类中心离图表左边至少要多远 */
export const rotFirstCenter = (first: string, s: number, tw: TextWidth) => ROT_EDGE + SIN45 * tw(first, s) + ROT_LEFT * s;

/** 画第 i 个分类标签：x 是分类中心，axisY 是轴线，centerY 是横排时标签中心 */
export function categoryLabel(fit: CatFit, i: number, text: string, x: number, axisY: number, centerY: number, st: TextStyle): string {
  const s = st.size;
  if (fit.kind === 'rot') {
    return `<g transform="translate(${n2(x - ROT_X * s)} ${n2(axisY + ROT_Y * s - ROT_Y0)}) rotate(-45)">${label(text, 0, 0, st, 'end')}</g>`;
  }
  if (fit.kind === 'wrap') return fit.lines[i].map((t, k) => label(t, x, centerY + k * WRAP_LINE * s, st)).join('');
  return label(text, x, centerY, st);
}
