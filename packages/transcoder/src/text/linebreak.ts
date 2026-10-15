/** 换行：中英文断行规则和标点禁则（行首不放句号逗号等，行尾不放左括号等） */
import type { Atom } from './types';

const NO_START = new Set([...'、。，．・：；？！゛゜ヽヾゝゞ々ー）］｝」』〕〉》】〙〗〟’”｠»,.:;?!)]}%…‥']);
const NO_END = new Set([...'（［｛「『〔〈《【〘〖〝‘“｟«([{']);

function canBreakBetween(a: Atom, b: Atom): boolean {
  if (NO_START.has(b.text) || NO_END.has(a.text)) return false;
  if (a.space || a.tab) return true;
  if (a.wide || b.wide) return true;
  if (a.text === '-' || a.text === '/') return true;
  return false;
}

/**
 * hang：允许标点溢出边界（a:pPr hangingPunct="1"，中文版 PowerPoint 的默认）——放不下的行首禁则标点不把前一个字带到下一行，
 * 而是挂在这一行的边界外面，每行最多挂一个
 */
export function breakLines(atoms: Atom[], avail: (first: boolean) => number, wrap: boolean, hang = false): Atom[][] {
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
      if (i > start && canBreakBetween(atoms[i - 1], a)) lastBreak = i;
      const w = width + a.width;
      if (wrap && w > max + 0.01 && i > start && !a.space) {
        if (!hang || hung || !NO_START.has(a.text)) break;
        hung = true;
      }
      width = w;
    }
    if (forced >= 0) {
      lines.push(atoms.slice(start, forced));
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
  return w;
}
