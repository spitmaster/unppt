/**
 * 竖排图例（左、右，手动框）的宽度上限和图例项折行。PowerPoint 实测（COM：图表宽 300 / 450 / 700 磅、字号 10 / 18 磅、
 * 系列名 2~24 个汉字，读 Legend.Width / Height；样本：百分比堆积图的图例项"组名：数值"折成两行）：
 *   - 图例宽（含内边距）最多 (图表宽 + 10 磅) / 3；图例宽 = 6 磅 + 0.9375 × 字号 + 最长一行文字宽；
 *   - 放不下的图例项折行：汉字之间都能断，西文、数字按词（空格）断；每多一行图例高多 1.03 × 字号。
 */
import type { TextWidth } from './layout';

const PT = 96 / 72;
/** 图例宽里除了文字的部分（键、间隔、内边距，像素）：s 是字号（像素） */
export const legendPad = (s: number) => 6 * PT + 0.9375 * s;
/** 文字可用的最大宽度（像素）：w 是图表宽 */
export const legendTextCap = (w: number, s: number) => (w + 10 * PT) / 3 - legendPad(s);
/** 每多一行的高度 */
export const legendWrapLine = (s: number) => 1.03 * s;

const wide = (ch: string) => /[⺀-鿿豈-﫿＀-￯　-〿]/.test(ch);

/** 贪心折行：汉字一个一个放，连续的西文、数字当一个词；一个词比整行还宽时单独占一行 */
export function wrapLegendText(text: string, cap: number, s: number, font: string | undefined, tw: TextWidth): string[] {
  if (tw(text, s, font) <= cap) return [text];
  const units: string[] = [];
  for (const m of text.matchAll(/\s+|[^\s⺀-鿿豈-﫿＀-￯　-〿]+|./gu)) units.push(m[0]);
  const lines: string[] = [];
  let cur = '';
  for (const u of units) {
    if (/^\s+$/.test(u)) { if (cur) cur += u; continue; }
    const next = cur + u;
    if (!cur || tw(next.trimEnd(), s, font) <= cap) cur = next;
    else { lines.push(cur.trimEnd()); cur = u; }
    // 标点不放在行首：汉字标点挂在上一行（和正文的行首禁则一样，宽度只超一点）
    if (wide(u) && /[，。、；：！？）」』”’》】]/.test(u) && cur === u && lines.length) { lines[lines.length - 1] += u; cur = ''; }
  }
  if (cur.trim()) lines.push(cur.trimEnd());
  return lines;
}
