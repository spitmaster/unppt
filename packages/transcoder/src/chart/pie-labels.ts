/**
 * 饼图数据标签的排版：各行的高度、"最佳位置"放进扇区还是放到饼外、饼外的位置。规则和依据见 SPEC 第 7 节。
 * 标签框 = 文字 + 左右各 3 磅、上下各 1.5 磅内边距；坐标都是像素，相对图表左上角
 */
import { hasCjk, label } from './draw';
import { LABEL_PAD_X, LABEL_PAD_Y, wrapLabel } from './label-wrap';
import { LINE_PAD, placeInSector, type Sector } from './sector-fit';
import type { TextWidth } from './layout';
import type { TextStyle } from './model';

export interface LabelLines { lines: string[]; widths: number[]; heights: number[] }

/** 没有东亚字体度量时按等线（上伸 + 下伸 = 1.042 em） */
const DEFAULT_EA_EM = 1.042;
/**
 * 实测（COM 读标签框高：雅黑 12 / 20 / 24 磅、等线 20 磅，一到三行）：带汉字的行高 1.3 × 东亚字体（上伸 + 下伸）× 字号
 * （雅黑 1.716、等线 1.355）；只有西文、数字的行（"18%"）按 1.4 × 字号、不超过带汉字的行（24 磅雅黑 + Arial 的标签导出图：
 * 汉字行到"18%"行的基线距 1.396 × 字号）。以前所有行都按 1.44 × 字号。
 * 试过把带汉字的行的字往下挪（PowerPoint 行高多出的 0.3 倍在字上面）：雅黑的用例好一点，等线的用例变差，没用
 */
export function measureLines(lines: string[], st: TextStyle, tw: TextWidth): LabelLines {
  const cj = 1.3 * (tw.eaEm?.(st.eaFont) ?? DEFAULT_EA_EM) * st.size, latin = Math.min(cj, 1.4 * st.size);
  return { lines, widths: lines.map((t) => tw(t, st.size, st.font)), heights: lines.map((t) => (hasCjk(t) ? cj : latin)) };
}

const total = (l: LabelLines) => l.heights.reduce((a, b) => a + b, 0);

/** 画多行标签：各行居中，(x, y) 是整块的中心 */
export function drawLines(l: LabelLines, x: number, y: number, st: TextStyle): string {
  let top = y - total(l) / 2;
  return l.lines.map((t, k) => {
    const cy = top + l.heights[k] / 2;
    top += l.heights[k];
    return label(t, x, cy, st);
  }).join('');
}

/**
 * 实测：放进扇区时最窄只折到最大宽度的 0.3（40 个 6 磅字的长标签最窄折成每行 8 个字、最大宽度的 0.42，再窄就放到饼外了；
 * "北区, 10"折成两行、0.39 还放里面；每行 2 个 12 磅字、0.21 的不放）
 */
const MIN_WRAP = 0.3;

/**
 * "最佳位置"放进扇区：先按最大宽度折行，放不下就一档一档折窄（每次比上一次最宽的一行再窄一点）再试；
 * 返回各行和标签中心（相对圆心），都放不下时 undefined
 */
export function fitInside(raw: string, maxW: number, st: TextStyle, tw: TextWidth, s: Sector): { l: LabelLines; x: number; y: number } | undefined {
  // 每个断不开的单位各占一行时已经最窄了
  const most = wrapLabel(raw, 0, st.size, tw, st.font).length;
  let width = maxW, prev = '';
  for (let first = true; ; first = false) {
    const l = measureLines(wrapLabel(raw, width, st.size, tw, st.font), st, tw);
    const widest = Math.max(...l.widths);
    if (!first && widest < MIN_WRAP * maxW) return undefined;
    const key = l.lines.join('\n');
    if (key !== prev) {
      const p = placeInSector(l.widths, l.heights, s);
      if (p) return { l, ...p };
      prev = key;
    }
    if (l.lines.length >= most) return undefined;
    width = Math.min(width, widest) - 0.5;
  }
}

/**
 * 实测（单个 2%~3% 的扇区，角平分线每隔 5°~30° 一个，宽标签、三行窄标签；6 块扇区的 24 磅标签）：角平分线的 |cos| < 0.22
 * （离竖直不到约 13°）时标签框横向居中，|sin| < 0.32（离水平不到约 19°）时竖向居中
 */
const CENTER_X = 0.22;
const CENTER_Y = 0.32;

/**
 * "最佳位置"放不下、放到饼外：锚点是角平分线和饼边（分离的扇区算上分离）的交点，标签框靠着锚点往外放——
 * 斜方向上框的一个角对着锚点（右下方的扇区是框的左上角），接近竖直（|cos| < 0.22）时框横向居中，接近水平（|sin| < 0.32）时竖向居中；
 * 还有哪一行压到饼上就沿角平分线往外推（按行算：两行标签里窄的那行旁边空着的角压到饼上不算）；再整个挪进图表里，
 * 挪了以后哪一行压到饼上就横着往外让开。(cx, cy) 是圆心，r 是到锚点的半径，mid 是角平分线（弧度），box 是图表宽高；返回标签中心
 */
export function placeOutside(l: LabelLines, cx: number, cy: number, r: number, mid: number, box: { w: number; h: number }): { x: number; y: number } {
  const c = Math.cos(mid), s = Math.sin(mid);
  const W = Math.max(...l.widths) + 2 * LABEL_PAD_X, H = total(l) + 2 * LABEL_PAD_Y;
  const fx = Math.abs(c) < CENTER_X ? 0 : Math.sign(c), fy = Math.abs(s) < CENTER_Y ? 0 : Math.sign(s);
  let x = cx + r * c + fx * W / 2, y = cy + r * s + fy * H / 2;
  // 某一行（左右各加 LINE_PAD，和放进扇区时一样）上离圆心最近的点在饼里
  const hits = () => {
    let top = y - total(l) / 2;
    return l.widths.some((w, k) => {
      const h = l.heights[k], dx = Math.max(0, Math.abs(x - cx) - w / 2 - LINE_PAD), dy = Math.max(0, Math.abs(top + h / 2 - cy) - h / 2);
      top += h;
      return dx * dx + dy * dy < r * r;
    });
  };
  for (let k = 0; k < 400 && hits(); k++) { x += c * 0.5; y += s * 0.5; }
  const x0 = Math.min(Math.max(x, W / 2), box.w - W / 2), y0 = Math.min(Math.max(y, H / 2), box.h - H / 2);
  if (x0 === x && y0 === y) return { x, y };
  x = x0; y = y0;
  const dir = x >= cx ? 1 : -1;
  for (let k = 0; k < 400 && hits(); k++) x += dir * 0.5;
  return { x, y };
}
