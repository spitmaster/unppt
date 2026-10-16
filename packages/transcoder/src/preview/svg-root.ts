/**
 * 出图前改写页面 SVG 用的小工具（occlusion.ts、layers.ts 共用）：按原文切出一段 XML 的顶层元素，找出引用和定义的 id。
 * 只处理转码器自己写出的 SVG（属性值用双引号、文字里的 < 已转义）。
 */

/** 一段 XML 里的顶层元素（按原文切开，元素之间的空白丢掉）；标签不配对时返回 undefined */
export function topElements(body: string): string[] | undefined {
  const out: string[] = [];
  let depth = 0, start = 0;
  for (const m of body.matchAll(/<(\/?)([a-zA-Z][\w:.-]*)(?:[^>"']|"[^"]*"|'[^']*')*?(\/?)>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g)) {
    if (m[2] === undefined) continue;  // 注释、CDATA
    if (m[1]) {
      depth--;
      if (depth < 0) return undefined;
      if (depth === 0) out.push(body.slice(start, m.index! + m[0].length));
    } else if (m[3]) {
      if (depth === 0) out.push(body.slice(m.index!, m.index! + m[0].length));
    } else {
      if (depth === 0) start = m.index!;
      depth++;
    }
  }
  return depth === 0 ? out : undefined;
}

/** 页面根元素 <svg …> 的开始标签、结束部分和下面的各个子元素 */
export function rootChildren(svg: string): { open: string; kids: string[]; close: string } | undefined {
  const open = /^<svg\b[^>]*>/.exec(svg)?.[0];
  const end = svg.lastIndexOf('</svg>');
  if (!open || end < 0) return undefined;
  const kids = topElements(svg.slice(open.length, end));
  return kids ? { open, kids, close: svg.slice(end) } : undefined;
}

/** 引用到的 id：url(#…) 和 href="#…"（也认 xlink:href） */
export function referencedIds(s: string): Set<string> {
  const ids = new Set<string>();
  for (const m of s.matchAll(/url\(#([^)\s"']+)\)|\s(?:xlink:)?href="#([^"]+)"/g)) ids.add(m[1] ?? m[2]);
  return ids;
}

/** 定义的 id */
export function definedIds(s: string): Set<string> {
  return new Set([...s.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
}
