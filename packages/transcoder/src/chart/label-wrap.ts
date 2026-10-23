/**
 * 数据标签折行（饼图、圆环图）：宽度上限随图表宽变，放不下就折行。
 * 断点：", " 之后（逗号留在上一行）、汉字前后；西文单词不拆；标点禁则——行首不放右括号、句号等，行尾不放左括号
 * （实测 charts-pie-label-wrap、charts-pie-bestfit-fit："12-36 小组（含）"折成"12-36 小组 /（含）"，不会把"）"单独放到下一行）
 */
import { NO_END, NO_START } from '../common/kinsoku';
import type { TextWidth } from './layout';

const PT = 96 / 72;

/**
 * 实测（COM 读标签框宽：图表宽 200~922.9 磅、4 / 6 / 8 / 16 磅字，数据标签内、居中、外、最佳位置都一样，和图表高无关）：
 * 标签框（含左右各 3 磅内边距）最宽 = 图表宽的 1/5，文字最宽 = 图表宽 × 0.2 − 6 磅；以前按 300 磅宽的图量的 0.173 倍，宽图上折得太早
 */
export const labelMaxWidth = (chartW: number) => 0.2 * chartW - 6 * PT;
/** 标签框的内边距（像素）：左右各 3 磅、上下各 1.5 磅（c:txPr 的 bodyPr 默认值） */
export const LABEL_PAD_X = 3 * PT;
export const LABEL_PAD_Y = 1.5 * PT;

/** 一段里不能拆开的单位：汉字（连同紧跟的", "）、西文词（连同紧跟的", "）、单独的", "、空白；再按标点禁则把放不到行首 / 行尾的字粘到邻居上 */
function tokens(para: string): string[] {
  const raw = para.match(/[⺀-鿿豈-﫿＀-￯　-〿](?:, ?)?|[^,\s⺀-鿿豈-﫿＀-￯　-〿]+(?:, ?)?|, ?|\s+/g) ?? [para];
  const out: string[] = [];
  for (const t of raw) {
    const prev = out[out.length - 1];
    if (prev !== undefined && (NO_START.has(t[0]) || NO_END.has(prev[prev.length - 1]))) out[out.length - 1] = prev + t;
    else out.push(t);
  }
  return out;
}

/** 按 maxW（像素）贪心折行，返回各行 */
export function wrapLabel(text: string, maxW: number, size: number, tw: TextWidth, font?: string): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let cur = '';
    for (const t of tokens(para)) {
      if (cur && tw((cur + t).trimEnd(), size, font) > maxW) { lines.push(cur.trimEnd()); cur = t.trimStart(); }
      else cur += t;
    }
    lines.push(cur.trimEnd());
  }
  return lines;
}
