/**
 * SmartArt 文字的行模型（和普通文本框的"单倍行高 = 1.2 × 字号"不同，行高按字体的度量算；SPEC 第 7 节）。
 * 实测（COM 生成 SmartArt，3 段同样的文字，20 种字体 × 40%~200% 行距 × 段前段后、顶端 / 居中 / 底端对齐，4 倍导出读基线）：
 *  - 中日韩字体（OS/2 代码页标了中日韩）：单倍行高 = 1.3 × (winAscent + winDescent)，多出的 0.3 倍上下各一半：
 *    基线离行框上沿 a + 0.15 × (a + d)（雅黑 20 磅一行 34.3 磅，普通文本框是 24 磅）；
 *  - 其它字体：单倍行高 = a + d + 外部行距（GDI 的 external leading，Arial 0.033、Times 0.042、Calibri 0），外部行距在上面；
 *  - 一行里用到几种字体时按每种字体的（基线以上、基线以下）各取最大的；
 *  - 段前段后的百分比按这一行的单倍行高算（雅黑 35% 段后 = 0.35 × 34.3 磅）。
 */
import type { FontMetrics } from '../font/font';

/** 一行（或一个字）的字体行框：基线以上 b、基线以下 d（像素，单倍行距）；ea：按中日韩字体的规则放基线（见 fontLineBaseline） */
export interface FontLine { b: number; d: number; ea: boolean }

/** 中日韩字体的单倍行高是上下伸的 1.3 倍（实测：黑体、宋体、楷体、仿宋、幼圆、MS Gothic 正好 1.3 × 字号，雅黑、正黑、等线、华文细黑、Yu Gothic、Malgun 都是 1.3 × (a + d)） */
const EA_LINE = 1.3;

/** 一个字的字体行框（size：字号，像素；没有度量时按缺省的上下伸） */
export function fontLine(m: FontMetrics | undefined, size: number): FontLine {
  const a = m?.ascent ?? 0.92, d = m?.descent ?? 0.24;
  if (m?.eastAsian) {
    const half = ((EA_LINE - 1) / 2) * (a + d);
    return { b: (a + half) * size, d: (d + half) * size, ea: true };
  }
  return { b: (a + (m?.extLeading ?? 0)) * size, d: d * size, ea: false };
}

/** 几个字合起来的行框：上下各取最大；规则按单倍行高最大的那个字体 */
export function mergeLines(list: FontLine[]): FontLine | undefined {
  if (!list.length) return undefined;
  let b = 0, d = 0, top = list[0];
  for (const l of list) {
    b = Math.max(b, l.b);
    d = Math.max(d, l.d);
    if (l.b + l.d > top.b + top.d) top = l;
  }
  return { b, d, ea: top.ea };
}

/**
 * 行高是 lh（行距已经算进去）时基线离行框上沿多远。实测：
 *  - 中日韩字体：比单倍行距多出（或少掉）的高度 75% 在基线上面、25% 在下面（雅黑、等线 40%~200% 误差 ≤ 0.15 磅；
 *    宋体、黑体不是 100% 时基线比这个高约 0.03 倍字号，没找到规律）；
 *  - 其它字体：和普通文字一样——行高更大时基线在 0.75 × 行高，更小时减少的高度从上面扣，扣到 0.75 × 行高为止
 *    （Arial、Calibri、Times 40%~200% 误差 ≤ 0.2 磅）。
 */
export function fontLineBaseline(l: FontLine, lh: number): number {
  const single = l.b + l.d;
  if (l.ea) return l.b + 0.75 * (lh - single);
  if (lh > single + 0.01) return 0.75 * lh;
  return Math.max(l.b - (single - lh), 0.75 * lh);
}
