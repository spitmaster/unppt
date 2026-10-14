/**
 * 底部分类标签放不下时怎么办（PowerPoint 实测：COM 生成 4~60 个分类、中文/英文/数字标签、9/12/16 磅的柱形、折线、
 * 面积图，读绘图区内框和标签间隔，导出图量标签位置）。从间隔 1（每个都显示）开始，依次试：
 *   - 每个标签宽 ≤ 分类宽 × 间隔：横排一行；
 *   - 每个标签都能在空格处折成每行 ≤ 分类宽 × 间隔：折行，标签带每多一行高 1.044 × 字号；
 *   - 分类宽 × 间隔 × 0.707 ≥ 1.3 × 字号：整体转 −45°（含没有空格的中文）：文字（右对齐、居中基线）的锚点在分类中心
 *     左 0.02 × 字号、轴下 1.27 × 字号 − 4.2；标签带高 0.707 × 最宽标签 + 1.54 × 字号；第一个标签伸出分类中心左边
 *     0.707 × 宽 + 0.17 × 字号，绘图区左边让它的墨迹离图表左边至少 10 像素；
 *   - 分类宽 × 间隔 ≥ 1.3 × 字号：竖排（转 −90°），文字末端在轴下 0.7 × 字号 − 2，标签带高最宽标签 + 0.62 × 字号；
 *   - 都不行就把间隔加 1（只显示第 1、1 + 间隔……个）。文件里写了间隔（c:tickLblSkip）时只按那个间隔试。
 * 例：24 个"第 N 周"竖排；40 个竖排、隔一个显示；1~40 的数字横排、隔一个显示；9~16 个四字中文转 −45°。
 */
import { n2 } from '../common/svg';
import { label } from './draw';
import type { TextWidth } from './layout';
import type { TextStyle } from './model';

export type CatFit = ({ kind: 'line' } | { kind: 'wrap'; lines: string[][]; n: number } | { kind: 'rot' } | { kind: 'vert' }) & { skip: number };

const SIN45 = Math.SQRT1_2;
/** 实测：折行每多一行的高度、斜标签带的常数项、斜标签末端的位置、第一个斜标签离图表左边的距离（像素，s 是字号） */
const WRAP_LINE = 1.044, ROT_BAND = 1.54, ROT_X = 0.02, ROT_Y = 1.27, ROT_Y0 = 4.2, ROT_LEFT = 0.17, ROT_EDGE = 10;
/** 实测：斜排、竖排要求的行距（× 字号）、竖排文字末端离轴、竖排标签带的常数项 */
const ROT_ROOM = 1.3, VERT_Y = 0.7, VERT_Y0 = 2, VERT_BAND = 0.62;

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

export function fitCategoryLabels(cats: string[], catW: number, s: number, tw: TextWidth, fixedSkip?: number): CatFit {
  const first = fixedSkip && fixedSkip > 0 ? fixedSkip : 1, last = fixedSkip ? first : Math.max(1, cats.length);
  for (let skip = first; ; skip++) {
    const w = catW * skip;
    const shown = cats.filter((_, i) => i % skip === 0);
    if (shown.every((c) => tw(c, s) <= w)) return { kind: 'line', skip };
    const wrapped = cats.map((c) => (tw(c, s) <= w ? [c] : wrapWords(c, w, s, tw)));
    if (wrapped.every((l) => l)) {
      const lines = wrapped as string[][];
      return { kind: 'wrap', lines, n: Math.max(...lines.filter((_, i) => i % skip === 0).map((l) => l.length)), skip };
    }
    if (SIN45 * w >= ROT_ROOM * s) return { kind: 'rot', skip };
    if (w >= ROT_ROOM * s || skip >= last) return { kind: 'vert', skip };
  }
}

/** 标签带的高度：横排、折行时在平常的带高 base 上加多出的行，斜排按最宽标签 */
export function catFitBand(fit: CatFit, base: number, cats: string[], s: number, tw: TextWidth): number {
  const widest = () => Math.max(0, ...cats.filter((_, i) => i % fit.skip === 0).map((c) => tw(c, s)));
  if (fit.kind === 'wrap') return base + (fit.n - 1) * WRAP_LINE * s;
  if (fit.kind === 'rot') return SIN45 * widest() + ROT_BAND * s;
  if (fit.kind === 'vert') return widest() + VERT_BAND * s;
  return base;
}

/** 实测：分类在端点上（面积图）转斜时绘图区右边留的空（× 字号，一个样例） */
export const ROT_MIDCAT_RIGHT = 1.05;

/** 斜排时第一个分类中心离图表左边至少要多远 */
export const rotFirstCenter = (first: string, s: number, tw: TextWidth) => ROT_EDGE + SIN45 * tw(first, s) + ROT_LEFT * s;

/** 画第 i 个分类标签：x 是分类中心，axisY 是轴线，centerY 是横排时标签中心 */
export function categoryLabel(fit: CatFit, i: number, text: string, x: number, axisY: number, centerY: number, st: TextStyle): string {
  const s = st.size;
  if (i % fit.skip) return '';
  if (fit.kind === 'vert') return `<g transform="translate(${n2(x)} ${n2(axisY + VERT_Y * s - VERT_Y0)}) rotate(-90)">${label(text, 0, 0, st, 'end')}</g>`;
  if (fit.kind === 'rot') {
    return `<g transform="translate(${n2(x - ROT_X * s)} ${n2(axisY + ROT_Y * s - ROT_Y0)}) rotate(-45)">${label(text, 0, 0, st, 'end')}</g>`;
  }
  if (fit.kind === 'wrap') return fit.lines[i].map((t, k) => label(t, x, centerY + k * WRAP_LINE * s, st)).join('');
  return label(text, x, centerY, st);
}

/**
 * 左右两侧的分类标签（条形图）：每个标签最宽 (图表宽 − 2 × 留白) / 2，超过就折行——中文在任意字之间、
 * 西文在空格处；多行时各行居中、行距 1.378 × 字号，整块右端（左侧标签）对齐原来的位置（PowerPoint 实测：
 * 300、450 磅宽的条形图，中文、英文长名称，折行位置和行距与导出图一致）
 */
const SIDE_MAX = 0.5, SIDE_LINE = 1.378;

export const sideLabelMax = (chartW: number, pad: number) => SIDE_MAX * (chartW - 2 * pad);

export function wrapSideLabel(t: string, maxW: number, s: number, tw: TextWidth): string[] {
  if (tw(t, s) <= maxW) return [t];
  // 记号：西文按词（连同后面的空格），中日韩字符一个字一个
  const tokens = t.match(/[⺀-鿿豈-﫿＀-￯]|[^\s⺀-鿿豈-﫿＀-￯]+\s*|\s+/g) ?? [t];
  const lines: string[] = [];
  let cur = '';
  for (const tok of tokens) {
    if (cur && tw((cur + tok).trimEnd(), s) > maxW) { lines.push(cur.trimEnd()); cur = tok.trimStart(); }
    else cur += tok;
  }
  if (cur.trim()) lines.push(cur.trimEnd());
  return lines;
}

/** 画一侧的分类标签：x 是标签右端（anchor = end）或左端（start）的对齐点 */
export function sideLabel(lines: string[], x: number, y: number, st: TextStyle, anchor: 'start' | 'end', tw: TextWidth): string {
  if (lines.length === 1) return label(lines[0], x, y, st, anchor);
  const w = Math.max(...lines.map((l) => tw(l, st.size)));
  const cx = anchor === 'end' ? x - w / 2 : x + w / 2;
  return lines.map((l, k) => label(l, cx, y + (k - (lines.length - 1) / 2) * SIDE_LINE * st.size, st)).join('');
}
