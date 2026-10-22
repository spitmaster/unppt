/** 换行：中英文断行规则和标点禁则（行首不放句号逗号等，行尾不放左括号等） */
import type { Atom } from './types';
import { LAYOUT_UNIT } from './measure';

const NO_START = new Set([...'、。，．・：；？！゛゜ヽヾゝゞ々ー）］｝」』〕〉》】〙〗〟’”｠»,.:;?!)]}%…‥']);
const NO_END = new Set([...'（［｛「『〔〈《【〘〖〝‘“｟«([{']);

/**
 * 可以悬挂在行外的字：行首禁则的标点，但半角 % 和省略号不挂，后面紧跟半角字符的半角 . , :（网址、小数、"CEO,CFO"）也不挂
 * （实测 tools/wraptest 框宽扫描："-3.2%"、"+21.3%" 的 % 和 "www.example" 的 . 到了行尾 PowerPoint 都不悬挂，而是在前面断，
 * "CEO,CFO|,CTO"、"https|://" 也是；"风险……"放不下时 … 不悬挂，整体换到下一行）
 */
const ASCII = /^[!-~]$/;
export const hangable = (t: string, next?: string) => NO_START.has(t) && t !== '%' && t !== '…' && t !== '‥' && !((t === '.' || t === ',' || t === ':') && next !== undefined && ASCII.test(next));

function canBreakBetween(a: Atom, b: Atom, kinsoku: boolean, latin: boolean): boolean {
  // 破折号后面总能断，后面是行首禁则的标点也一样（"险——|……"、"险——|。"，实测 tools/wraptest 框宽扫描）
  if (a.text === '—') return true;
  if (kinsoku && (a.style.eaBreak || b.style.eaBreak) && (NO_START.has(b.text) || NO_END.has(a.text))) return false;
  // 破折号和前一个字之间不断（"表明——"整体换行；两个 — 之间能断，见上一条。实测 tools/wraptest 框宽扫描）
  if (b.text === '—') return false;
  if (a.space || a.tab || latin) return true;
  if (a.wide || b.wide) return true;
  // 实测：连字符后面可以断；斜杠后面不断（text-slash-break：short/longerword、网址都是放不下时在字中间断）
  if (a.text === '-') return true;
  return false;
}

/**
 * 空格前面紧挨着的字是行尾禁则的字（"（ e.g."）：空格后面也不能断；空格后面紧挨着的是行首禁则的字（"。 ）"）：空格前面也不能断
 * （实测 tools/wraptest：PowerPoint 把"（"一起带到下一行，把"习。 ）"一起带到下一行）
 */
function endsOpen(atoms: Atom[], i: number): boolean {
  while (i >= 0 && atoms[i].space) i--;
  return i >= 0 && NO_END.has(atoms[i].text) && !!atoms[i].style.eaBreak;
}
function startsClose(atoms: Atom[], i: number): boolean {
  while (i < atoms.length && atoms[i].space) i++;
  return i < atoms.length && NO_START.has(atoms[i].text) && !!atoms[i].style.eaBreak;
}

/**
 * hang：允许标点溢出边界（a:pPr hangingPunct，中文版 PowerPoint 没写时也开着）——放不下的行首禁则标点不把前一个字带到下一行，
 * 而是挂在这一行的边界外面，每行最多挂一个。
 * kinsoku：按中文习惯控制首尾字符（a:pPr eaLnBrk，默认开）；实测（text-ea-line-break）关掉时行首可以是"，。"、行尾可以是"（"，
 * 标点溢出边界也不起作用。两条都只在断点两边至少有一个字的语言（rPr lang 或 altLang）是中日韩时管：前后的字都在 lang 写成 en-US
 * 或没写、也没有中日韩 altLang 的文字段里时，标点照常可以在行首、也不悬挂（实测 text-ea-lang；样本：lang="en-US" altLang="zh-CN" 照样悬挂；
 * text-hanging-punct 里单独一段 en-US 的半角标点跟在中文后面照样悬挂）
 * latin：允许西文在单词中间换行（a:pPr latinLnBrk="1"）——任意两个字之间都能断，标点禁则照样管（实测 text-latin-break）
 */
export function breakLines(atoms: Atom[], avail: (first: boolean) => number, wrap: boolean, hang = false, kinsoku = true, latin = false): Atom[][] {
  const lines: Atom[][] = [];
  let start = 0;
  while (start < atoms.length) {
    const max = avail(lines.length === 0);
    let width = 0;
    let lastBreak = -1;
    let i = start;
    let forced = -1;
    let hung = false;
    for (; i < atoms.length; i++) {
      const a = atoms[i];
      if (a.text === '\n') { forced = i; break; }
      if (i > start && canBreakBetween(atoms[i - 1], a, kinsoku, latin) && !(kinsoku && (atoms[i - 1].space && endsOpen(atoms, i - 1) || a.space && startsClose(atoms, i)))) lastBreak = i;
      const w = width + a.width;
      // 实测：行宽向上取整到排版单位（1/8 磅）后不超过可用宽度才放得下（可用宽度、内边距不取整；字间距让行宽不在格子上时，
      // 正好等宽也要换行）。这个字在行尾时不算它和后一个字的字距调整（实测 tools/wraptest：微软雅黑 "me|r-"，r 和 - 有负字距）
      if (wrap && Math.ceil((w - (a.kern ?? 0)) / LAYOUT_UNIT - 1e-6) * LAYOUT_UNIT > max + 1e-6 && i > start && !a.space) {
        // 前面也能正常断（"险——|。"）时，这一行剩下的空不到 0.1 个字才在前面断，否则照样悬挂
        // （实测 tools/wraptest 框宽扫描：宋体 10、20、40 磅都在剩 0.085~0.11 个字之间变）
        // 前面的字本身就放不下（框比一个字还窄）时也不悬挂（实测 tools/wraptest：宋体 40 磅框宽 54 磅，"险|。"）
        if (!hang || !kinsoku || hung || width > max + 1e-6 || (lastBreak === i && max - width < a.style.size * 0.1) || !hangable(a.text, atoms[i + 1]?.text) || !(a.style.eaBreak || atoms[i - 1].style.eaBreak)) break;
        hung = true;
      }
      width = w;
    }
    if (forced >= 0) {
      // 换行符留在这一行的末尾（空行的行高按它的字号，见 paragraph.ts）
      lines.push(atoms.slice(start, forced + 1));
      start = forced + 1;
      if (start === atoms.length) lines.push([]);
      continue;
    }
    if (i >= atoms.length) {
      lines.push(atoms.slice(start));
      break;
    }
    let end = lastBreak > start ? lastBreak : i;
    lines.push(atoms.slice(start, end));
    // 行首的空格吞掉
    while (end < atoms.length && atoms[end].space) end++;
    start = end;
  }
  return lines;
}

export function trimmedWidth(atoms: Atom[]): number {
  let w = 0;
  let last = atoms.length - 1;
  while (last >= 0 && atoms[last].space) last--;
  for (let i = 0; i <= last; i++) w += atoms[i].width;
  return last >= 0 ? w - (atoms[last].kern ?? 0) : w;
}
