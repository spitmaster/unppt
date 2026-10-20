/**
 * 文字里直接写的回车、换行符（a:t 里的 &#13; &#10;，PPT 转换、程序生成的课件常见）在 PowerPoint 里是分段：
 * 每段各自加段前段后间距、各自画项目符号（实测 text-cr-paragraph）。排版前把这样的 a:p 拆成几段，段落属性照抄，
 * 断开处前面一段的段尾属性用断开的那个文字块的属性。
 */
import { child, type XEl } from '../io/xml';

const BREAK = /\r\n|\r|\n/;

export function splitBreaks(p: XEl): XEl[] {
  if (!p.children.some((r) => r.name === 'a:r' && BREAK.test(child(r, 'a:t')?.text ?? ''))) return [p];
  const pPr = child(p, 'a:pPr');
  const out: XEl[] = [];
  let cur: XEl[] = [];
  const close = (end: XEl | undefined) => {
    out.push({ ...p, children: [...(pPr ? [pPr] : []), ...cur, ...(end ? [end] : [])] });
    cur = [];
  };
  for (const r of p.children) {
    if (r === pPr) continue;
    if (r.name === 'a:endParaRPr') { close(r); continue; }
    const t = r.name === 'a:r' ? child(r, 'a:t') : undefined;
    if (!t || !BREAK.test(t.text)) { cur.push(r); continue; }
    const rPr = child(r, 'a:rPr');
    const pieces = t.text.split(BREAK);
    pieces.forEach((s, i) => {
      if (i > 0) close(rPr && { ...rPr, name: 'a:endParaRPr' });
      if (s) cur.push({ ...r, children: r.children.map((c) => (c === t ? { ...t, text: s } : c)) });
    });
  }
  if (cur.length || out.length === 0 || p.children[p.children.length - 1]?.name !== 'a:endParaRPr') close(undefined);
  return out;
}
