/** 换行：中英文断行规则和标点禁则（行首不放句号逗号等，行尾不放左括号等） */
import type { Atom } from './types';
import { LAYOUT_UNIT, eaSlot } from './measure';

const NO_START = new Set([...'、。，．・：；？！゛゜ヽヾゝゞ々ー）］｝」』〕〉》】〙〗〟’”｠»,.:;?!)]}%…‥']);
const NO_END = new Set([...'（［｛「『〔〈《【〘〖〝‘“｟«([{']);

/**
 * 可以悬挂在行外的字：行首禁则的标点，但半角 % 和省略号不挂，后面紧跟半角字符的半角 . , :（网址、小数、"CEO,CFO"）也不挂
 * （实测 tools/wraptest 框宽扫描："-3.2%"、"+21.3%" 的 % 和 "www.example" 的 . 到了行尾 PowerPoint 都不悬挂，而是在前面断，
 * "CEO,CFO|,CTO"、"https|://" 也是；"风险……"放不下时 … 不悬挂，整体换到下一行）。
 * 允许西文在单词中间换行（latin，a:pPr latinLnBrk="1"）时 . , : 照样悬挂、在它后面断（实测 tools/wraptest 框宽扫描：雅黑 24 磅粗体
 * "比例为1:|3"、"a:|b"、"1.|5"、"1,|2"、"A.|B"、"x:|//y"）
 */
const ASCII = /^[!-~]$/;
const QUOTES = new Set([...'‘’“”']);
const latinLike = (cp: number) => eaSlot(cp) && !(cp >= 0x2460 && cp <= 0x24ff);
export const hangable = (t: string, next?: string, latin = false) => NO_START.has(t) && t !== '%' && t !== '…' && t !== '‥'
  && !(!latin && (t === '.' || t === ',' || t === ':') && next !== undefined && ASCII.test(next));

function canBreakBetween(a: Atom, b: Atom, kinsoku: boolean, latin: boolean): boolean {
  // 不间断空格前后都不断（实测 tools/wraptest："关|注\u00a0风" 整体换行）
  if (a.text === '\u00a0' || b.text === '\u00a0') return false;
  // 破折号后面总能断，后面是行首禁则的标点也一样（"险——|……"、"险——|。"，实测 tools/wraptest 框宽扫描）
  if (a.text === '—') return true;
  if (kinsoku && (a.style.eaBreak || b.style.eaBreak) && (NO_START.has(b.text) || NO_END.has(a.text))) return false;
  // 制表符前面能断：要跳到的位置超出行宽时，制表符连同后面的字一起到下一行（实测 tools/wraptest："\tabc|\tdef"）
  if (b.tab) return true;
  // 右引号紧跟左引号（"新闻”“长江"）之间不断，右引号也就不悬挂（实测 tools/wraptest："湖北新|闻”“"；"义》“以"照样能断）
  if ((a.text === '”' && b.text === '“') || (a.text === '’' && b.text === '‘')) return false;
  // 破折号和前一个字之间不断（"表明——"整体换行；两个 — 之间能断，见上一条。实测 tools/wraptest 框宽扫描）。
  // 这是中文的禁则：前后有一个字的语言（lang 或 altLang）是中日韩、按中文习惯控制首尾字符又关掉（eaLnBrk="0"）时不管，按下面的一般规则——
  // 汉字、空格后面能断，西文字母后面照样不断；两边都不是中日韩语言时空格后面也能断，开关都一样（实测 tools/wraptest 框宽扫描，
  // 宋体 20 磅："关注风险|——实验"、"关注练习 |——实验"、"aa |word——"，破折号那段标 en-US 也一样，雅黑 + Calibri 粗体、楷体 24 磅一样；
  // Arial 20 磅 "word word |—— word"：en-US 开关都这样，en-US + altLang="zh-CN" 只在关掉时这样）
  if (b.text === '—' && ((a.style.eaBreak || b.style.eaBreak) ? kinsoku : !a.space)) return false;
  // 弯引号和紧挨着的西文字母数字之间不断（"入选|“2019"、"险”abc"）；按中文习惯控制首尾字符关掉时也一样（实测 tools/wraptest 框宽扫描，eaLnBrk 开 / 关）
  if (!a.space && !b.space && !a.tab && !b.tab && ((QUOTES.has(a.text) && !b.wide) || (QUOTES.has(b.text) && !a.wide))) return false;
  if (a.space || a.tab || latin) return true;
  // 用东亚字体排的符号（± × § ° ★ □ 等，见 measure.ts EA_SLOT）断行时按西文算：和前后的字母数字之间、几个连着的之间不断
  // （实测 tools/wraptest："风险|±10V"、"险|10°C"、"关注|★★★|实验"）；带圈数字 ①② 例外，和汉字一样两边都能断（"关注①|②③④"）
  if ((a.wide && !latinLike(a.cp)) || (b.wide && !latinLike(b.cp))) return true;
  // 实测：连字符后面可以断；斜杠后面不断（text-slash-break：short/longerword、网址都是放不下时在字中间断）
  if (a.text === '-') return true;
  return false;
}

/** 每个位置往前、往后最近的非空格字（含自己）：很长的空格段里不用每次都往两边找 */
interface Around { prev: Int32Array; next: Int32Array }
function around(atoms: Atom[]): Around {
  const n = atoms.length;
  const prev = new Int32Array(n), next = new Int32Array(n + 1);
  for (let k = 0, p = -1; k < n; k++) { if (!atoms[k].space) p = k; prev[k] = p; }
  next[n] = n;
  for (let k = n - 1; k >= 0; k--) next[k] = atoms[k].space ? next[k + 1] : k;
  return { prev, next };
}

/**
 * 空格前面紧挨着的字是行尾禁则的字（"（ e.g."）：空格后面也不能断；空格后面紧挨着的是行首禁则的字（"。 ）"）：空格前面也不能断
 * （实测 tools/wraptest：PowerPoint 把"（"一起带到下一行，把"习。 ）"一起带到下一行）
 */
function endsOpen(atoms: Atom[], ar: Around, i: number): boolean {
  const j = ar.prev[i];
  return j >= 0 && NO_END.has(atoms[j].text) && !!atoms[j].style.eaBreak;
}
function startsClose(atoms: Atom[], ar: Around, i: number): boolean {
  const j = ar.next[i];
  return j < atoms.length && NO_START.has(atoms[j].text) && !!atoms[j].style.eaBreak;
}
/**
 * 空格后面是中文里的破折号（"练习 ——"）：空格前面也不能断，破折号连同空格跟着前一个字（实测 tools/wraptest；英文里照样能断）。
 * 和上面两条一样只在按中文习惯控制首尾字符开着时管：关掉时空格后面就能断（"练习 |——"，实测 tools/wraptest）
 */
function startsDash(atoms: Atom[], ar: Around, i: number): boolean {
  const j = ar.next[i];
  return j < atoms.length && atoms[j].text === '—' && !!atoms[j].style.eaBreak;
}

/**
 * 一行的空间：max 是可用宽度，lead 是这一行的左右缩进之和（行首起点 + 右缩进，相对内容区左边），lead + max 是内容区宽度。
 * 行尾按 lead + 行宽取整（实测：起点 16.8 磅、行宽 150.15 磅时 167 磅宽的框放得下；分别取整要 167.125 磅）
 */
export interface LineRoom { max: number; lead: number }

/**
 * hang：允许标点溢出边界（a:pPr hangingPunct，中文版 PowerPoint 没写时也开着）——放不下的行首禁则标点不把前一个字带到下一行，
 * 而是挂在这一行的边界外面，每行最多挂一个。
 * kinsoku：按中文习惯控制首尾字符（a:pPr eaLnBrk，默认开）；实测（text-ea-line-break）关掉时行首可以是"，。"、行尾可以是"（"，
 * 这时标点前面本来就能断，溢出边界按"剩下的空至少 0.1 个字"处理（见下面 hung 的条件）。两条都只在断点两边至少有一个字的语言（rPr lang 或 altLang）是中日韩时管：前后的字都在 lang 写成 en-US
 * 或没写、也没有中日韩 altLang 的文字段里时，标点照常可以在行首、也不悬挂（实测 text-ea-lang；样本：lang="en-US" altLang="zh-CN" 照样悬挂；
 * text-hanging-punct 里单独一段 en-US 的半角标点跟在中文后面照样悬挂）
 * latin：允许西文在单词中间换行（a:pPr latinLnBrk="1"）——任意两个字之间都能断，标点禁则照样管（实测 text-latin-break）
 */
export function breakLines(atoms: Atom[], room: (first: boolean) => LineRoom, wrap: boolean, hang = false, kinsoku = true, latin = false,
  relayout?: (start: number, first: boolean, limit: number) => void): Atom[][] {
  const lines: Atom[][] = [];
  const ar = around(atoms);
  let start = 0;
  while (start < atoms.length) {
    const { max, lead } = room(lines.length === 0);
    // 行宽 wd 放不下：行首起点 + 行宽 + 右缩进向上取整到 1/8 磅后超出内容区（见下面断行的说明）
    const over = (wd: number) => Math.ceil((lead + wd) / LAYOUT_UNIT - 1e-6) * LAYOUT_UNIT > lead + max + 1e-6;
    // 新的一行从头重排制表符（制表位按这一行的起点算；只需排到这一行放不下为止，后面的字到它们那一行的开头再排）
    if (start > 0) relayout?.(start, lines.length === 0, wrap ? max : Infinity);
    let width = 0;
    let lastBreak = -1;
    let i = start;
    let forced = -1;
    let hung = -1;
    for (; i < atoms.length; i++) {
      const a = atoms[i];
      if (a.text === '\n') { forced = i; break; }
      if (i > start && canBreakBetween(atoms[i - 1], a, kinsoku, latin) && !(kinsoku && (atoms[i - 1].space && endsOpen(atoms, ar, i - 1) || a.space && startsClose(atoms, ar, i) || a.space && startsDash(atoms, ar, i)))) lastBreak = i;
      const w = width + a.width;
      // 实测：这一行的左右缩进之和（lead）加上行宽，向上取整到排版单位（1/8 磅）后不超过内容区宽度（lead + max）才放得下
      // （内边距、框宽不取整；字间距让行宽不在格子上时，正好等宽也要换行；缩进本身只取整到 1/20 磅，见 paragraph.ts twips）。
      // 这个字在行尾时不算它和后一个字的字距调整（实测 tools/wraptest：微软雅黑 "me|r-"，r 和 - 有负字距），
      // 后一个字是能悬挂的标点时还在这一行，照算（Arial 粗体 "Friday." 的 y. 有负字距，y 放得下、. 悬挂）
      const next = atoms[i + 1];
      const endKern = next && hang && hangable(next.text, atoms[i + 2]?.text, latin) ? 0 : a.kern ?? 0;
      if (wrap && over(w - endKern) && i > start && !a.space) {
        // 前面也能正常断（"险——|。"）时，这一行剩下的空不到 0.1 个字才在前面断，否则照样悬挂
        // （实测 tools/wraptest 框宽扫描：宋体 10、20、40 磅都在剩 0.085~0.11 个字之间变）
        // 前面的字本身就放不下（框比一个字还窄，或者连同行尾的空格按上面的取整超出）时也不悬挂（实测 tools/wraptest：宋体 40 磅框宽 54 磅，
        // "险|。"；随机用例：Calibri 32 磅 ".6% " 加左缩进取整后比内容区宽 0.07 磅，后面的"，"不悬挂、换到下一行）
        // 悬挂的标点后面得能断（后面紧跟的字不能和它分开时不挂）
        if (!hang || hung >= 0 || (atoms[i + 1] && !atoms[i + 1].space && atoms[i + 1].text !== '\n' && !canBreakBetween(a, atoms[i + 1], kinsoku, latin)) || over(width) || (lastBreak === i && max - width < a.style.size * 0.1) || !hangable(a.text, atoms[i + 1]?.text, latin) || !(a.style.eaBreak || atoms[i - 1].style.eaBreak)) break;
        hung = i;
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
    // 悬挂了一个标点后后面的标点还是放不下（"险。；"）：不悬挂了，没有正常断点时从悬挂的标点前面断，标点一起到下一行
    // （实测 tools/wraptest：宋体 20 磅框宽 54 磅 "险|。；"）
    let end = lastBreak > start ? lastBreak : hung > start ? hung : i;
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
