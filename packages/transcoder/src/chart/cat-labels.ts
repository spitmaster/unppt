/**
 * 底部分类标签放不下时怎么办（PowerPoint 实测：COM 生成 4~60 个分类、中文/英文/数字标签、9/12/16 磅的柱形、折线、
 * 面积图，读绘图区内框和标签间隔，导出图量标签位置）。从间隔 1（每个都显示）开始，依次试：
 *   - 每个标签宽 ≤ 分类宽 × 间隔：横排一行；
 *   - 每个标签都能在空格处折成每行 ≤ 分类宽 × 间隔：折行，标签带每多一行高 1.044 × 字号；
 *   - 分类宽 × 间隔 × 0.707 ≥ 1.75 × 字号：整体转 −45°（含没有空格的中文；原来按 1.3 倍，charts-cat-rot-len 和样本：分类宽 2.72 倍字号斜排、
 *     2.17 倍竖排）：文字（右对齐、居中基线）的锚点在分类中心
 *     左 0.02 × 字号、轴下 1.27 × 字号 − 4.2；标签带高 0.707 × 最宽标签 + 1.54 × 字号（标签都不带中文时 0.667 × 最宽标签）；
 *     绘图区左边让第一个分类的中心离图表左边至少 15.4 + 0.667 × 第一个标签宽（9~20 磅、2~8 个字、中英文都成立）；
 *   - 分类宽 × 间隔 ≥ 1 × 字号：竖排（转 −90°），文字末端在轴下 0.7 × 字号 − 2，标签带高最宽标签 + 0.62 × 字号
 *     （charts-cat-vertical：12 磅、每个分类 1.09 倍字号时竖排全显示，0.91 倍时隔一个）；标签带最多和绘图区一样高，
 *     更长的标签按字截断、加省略号（capVertical）；
 *   - 都不行就把间隔加 1（只显示第 1、1 + 间隔……个）。文件里写了间隔（c:tickLblSkip）时只按那个间隔试。
 * 例：24 个"第 N 周"竖排；40 个竖排、隔一个显示；1~40 的数字横排、隔一个显示；9~16 个四字中文转 −45°。
 */
import { n2 } from '../common/svg';
import { hasCjk, label } from './draw';
import type { TextWidth } from './layout';
import type { CatLevel, TextStyle } from './model';

export type CatFit = ({ kind: 'line' } | { kind: 'wrap'; lines: string[][]; n: number } | { kind: 'rot'; cut?: string[] } | { kind: 'vert'; cut?: string[] } | { kind: 'ea' }) & { skip: number };

const SIN45 = Math.SQRT1_2;
/** 实测：折行每多一行的高度、斜标签带的常数项、斜标签末端的位置、第一个斜标签的中心离图表左边的距离（像素，s 是字号） */
const WRAP_LINE = 1.044, ROT_BAND = 1.54, ROT_X = 0.02, ROT_Y = 1.27, ROT_Y0 = 4.2, ROT_EDGE = 15.4, ROT_SPAN = 0.667;
/** 实测：斜排、竖排要求的行距（× 字号）、竖排文字末端离轴、竖排标签带的常数项 */
const ROT45_ROOM = 1.75, VERT_ROOM = 1, VERT_Y = 0.7, VERT_Y0 = 2, VERT_BAND = 0.62;
/**
 * 实测（charts-axis-ea-vert：12 磅、1~6 个汉字）：文字设成东亚竖排（bodyPr vert="eaVert"）时每个字往下排、字距 1 个字号，
 * 第一个字的上沿在轴下 0.56 × 字号；标签带比横排一行的高 (最多的字数 − 1.375) × 字号
 */
const EA_TOP = 0.56, EA_LINE = 1.375;
/** 实测：多级分类外层每级的标签带比单级的少的高度 */
const LEVEL_TRIM = 0.6;

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

export function fitCategoryLabels(cats: string[], catW: number, s: number, tw: TextWidth, fixedSkip?: number, eaVert = false): CatFit {
  const first = fixedSkip && fixedSkip > 0 ? fixedSkip : 1, last = fixedSkip ? first : Math.max(1, cats.length);
  if (eaVert) return { kind: 'ea', skip: first };
  for (let skip = first; ; skip++) {
    const w = catW * skip;
    const shown = cats.filter((_, i) => i % skip === 0);
    if (shown.every((c) => tw(c, s) <= w)) return { kind: 'line', skip };
    const wrapped = cats.map((c) => (tw(c, s) <= w ? [c] : wrapWords(c, w, s, tw)));
    if (wrapped.every((l) => l)) {
      const lines = wrapped as string[][];
      return { kind: 'wrap', lines, n: Math.max(...lines.filter((_, i) => i % skip === 0).map((l) => l.length)), skip };
    }
    if (SIN45 * w >= ROT45_ROOM * s) return { kind: 'rot', skip };
    if (w >= VERT_ROOM * s || skip >= last) return { kind: 'vert', skip };
  }
}

/** 标签带的高度：横排、折行时在平常的带高 base 上加多出的行，斜排按最宽标签 */
export function catFitBand(fit: CatFit, base: number, cats: string[], s: number, tw: TextWidth): number {
  const shownW = (list: string[]) => Math.max(0, ...list.filter((_, i) => i % fit.skip === 0).map((c) => tw(c, s)));
  const widest = () => shownW(fit.kind === 'rot' || fit.kind === 'vert' ? fit.cut ?? cats : cats);
  if (fit.kind === 'wrap') return base + (fit.n - 1) * WRAP_LINE * s;
  if (fit.kind === 'rot') return (cats.some(hasCjk) ? SIN45 : ROT_SPAN) * widest() + ROT_BAND * s;
  if (fit.kind === 'vert') return widest() + VERT_BAND * s;
  if (fit.kind === 'ea') return base + (Math.max(1, ...cats.filter((_, i) => i % fit.skip === 0).map((c) => [...c].length)) - EA_LINE) * s;
  return base;
}

/**
 * 竖排、斜排的标签带最多和绘图区一样高（room 是绘图区和标签带一共的高度）：更长的标签按字截断、末尾加省略号，标签带按截断后的算
 * （实测 charts-cat-vertical、charts-long-cats：图表高 160~460 磅，20 个字的名称，标签带等于绘图区高或比它少不到一个字；
 * charts-cat-rot-len：斜排的 9~16 个字名称同样截断）
 */
export function capVertical(fit: CatFit, cats: string[], s: number, tw: TextWidth, room: number): CatFit {
  if ((fit.kind !== 'vert' && fit.kind !== 'rot') || catFitBand(fit, 0, cats, s, tw) <= room / 2) return fit;
  const max = fit.kind === 'vert' ? room / 2 - VERT_BAND * s : (room / 2 - ROT_BAND * s) / (cats.some(hasCjk) ? SIN45 : ROT_SPAN);
  const cut = cats.map((c) => {
    if (tw(c, s) <= max) return c;
    const chars = [...c];
    while (chars.length && tw(chars.join('') + '\u2026', s) > max) chars.pop();
    return chars.join('') + '\u2026';
  });
  return { ...fit, cut };
}

/** 实测：分类在端点上（面积图）转斜时绘图区右边留的空（× 字号，一个样例） */
export const ROT_MIDCAT_RIGHT = 1.05;

/** 斜排时第一个分类中心离图表左边至少要多远 */
export const rotFirstCenter = (first: string, s: number, tw: TextWidth) => ROT_EDGE + ROT_SPAN * tw(first, s);

/** 画第 i 个分类标签：x 是分类中心，axisY 是轴线，centerY 是横排时标签中心 */
export function categoryLabel(fit: CatFit, i: number, text: string, x: number, axisY: number, centerY: number, st: TextStyle): string {
  const s = st.size;
  if (i % fit.skip) return '';
  if (fit.kind === 'vert') return `<g transform="translate(${n2(x)} ${n2(axisY + VERT_Y * s - VERT_Y0)}) rotate(-90)">${label(fit.cut?.[i] ?? text, 0, 0, st, 'end')}</g>`;
  if (fit.kind === 'ea') return [...text].map((ch, k) => label(ch, x, axisY + (EA_TOP + k + 0.5) * s, st)).join('');
  if (fit.kind === 'rot') {
    return `<g transform="translate(${n2(x - ROT_X * s)} ${n2(axisY + ROT_Y * s - ROT_Y0)}) rotate(-45)">${label(fit.cut?.[i] ?? text, 0, 0, st, 'end')}</g>`;
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
  const w = Math.max(...lines.map((l) => tw(l, st.size, st.font)));
  const cx = anchor === 'end' ? x - w / 2 : x + w / 2;
  return lines.map((l, k) => label(l, cx, y + (k - (lines.length - 1) / 2) * SIDE_LINE * st.size, st)).join('');
}

/**
 * 多级分类（c:multiLvlStrRef）底部的外层标签：每级占一条标签带（和单级一样按带不带中文取 catBand / valBand，
 * 再少 0.6 像素），标签居中于各组；组的分界和绘图区两端画竖分隔线，从轴线一直到这一级标签带的底边
 * （PowerPoint 实测：两级的柱形、折线图，"年份 → 季度"中文和数字两种）
 */
export interface LevelBand { level: CatLevel; band: number; cjk: boolean }

export function outerLevelBands(levels: CatLevel[], s: number, bandOf: (cjk: boolean, s: number) => number): LevelBand[] {
  return levels.map((level) => {
    const cjk = level.some((g) => hasCjk(g.text));
    return { level, band: bandOf(cjk, s) - LEVEL_TRIM, cjk };
  });
}

/** 画外层标签和分隔线：pos(i) 是第 i 个分类边界（0~nCat）在屏幕上的 x，top 是内层标签带的底边 */
export function outerLevels(bands: LevelBand[], nCat: number, pos: (i: number) => number, axisY: number, top: number,
  st: TextStyle, centerOf: (cjk: boolean, s: number) => number, line: { color: string; width: number } | undefined): string {
  const out: string[] = [];
  let y = top;
  for (const { level, band, cjk } of bands) {
    level.forEach((g, k) => {
      const end = k + 1 < level.length ? level[k + 1].idx : nCat;
      out.push(label(g.text, (pos(g.idx) + pos(end)) / 2, y + centerOf(cjk, st.size), st));
    });
    if (line) {
      const xs = [...level.map((g) => g.idx), nCat].map(pos);
      out.push(`<path d="${xs.map((x) => `M${n2(x)} ${n2(axisY)}V${n2(y + band)}`).join('')}" fill="none" stroke="${line.color}" stroke-width="${n2(line.width)}"/>`);
    }
    y += band;
  }
  return out.join('');
}

/**
 * 条形图（分类轴在左）的外层标签：每级占一列，最外一级从图表边 SIDE_LABEL_PAD 处排起，列宽 2.12 × 字号
 * （外层标签不带中文时 1.84 × 字号）；标签转 −90° 居中于各组，中心离列的左边 0.58 × 字号（不带中文时 0.44 × 字号）；组的分界和绘图区两端画横分隔线，
 * 从轴线一直到这一列左边再往外 2.3 像素（PowerPoint 实测：9~20 磅、中英文外层、长短内层标签的两级条形图，
 * 分隔线左端都在图表边 + 6.3 像素，标签墨迹误差 ≤ 1 像素）
 */
const SIDE_LEVEL_CJK = 2.12, SIDE_LEVEL_LATIN = 1.84, SIDE_LEVEL_CENTER = 0.58, SIDE_LEVEL_CENTER_LATIN = 0.44, SIDE_LEVEL_LINE = 2.3;

export const sideLevelBands = (levels: CatLevel[], s: number): LevelBand[] => levels.map((level) => {
  const cjk = level.some((g) => hasCjk(g.text));
  return { level, band: (cjk ? SIDE_LEVEL_CJK : SIDE_LEVEL_LATIN) * s, cjk };
});

/** 画左侧外层标签和分隔线：pos(i) 是第 i 个分类边界在屏幕上的 y，axisX 是轴线，x0 是最外一列的左边 */
export function sideOuterLevels(bands: LevelBand[], nCat: number, pos: (i: number) => number, axisX: number, x0: number,
  st: TextStyle, line: { color: string; width: number } | undefined): string {
  const out: string[] = [];
  let x = x0;
  for (const { level, band, cjk } of [...bands].reverse()) {
    level.forEach((g, k) => {
      const end = k + 1 < level.length ? level[k + 1].idx : nCat;
      out.push(`<g transform="translate(${n2(x + (cjk ? SIDE_LEVEL_CENTER : SIDE_LEVEL_CENTER_LATIN) * st.size)} ${n2((pos(g.idx) + pos(end)) / 2)}) rotate(-90)">${label(g.text, 0, 0, st)}</g>`);
    });
    if (line) {
      const ys = [...level.map((g) => g.idx), nCat].map(pos);
      out.push(`<path d="${ys.map((y) => `M${n2(axisX)} ${n2(y)}H${n2(x - SIDE_LEVEL_LINE)}`).join('')}" fill="none" stroke="${line.color}" stroke-width="${n2(line.width)}"/>`);
    }
    x += band;
  }
  return out.join('');
}
