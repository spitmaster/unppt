/**
 * XML 解析（用 saxes）和查询辅助，专为 OOXML 设计。
 *
 * 命名空间会被换成固定前缀（p:、a:、r: 等），不管文件里实际用的是什么前缀，
 * 后面的代码都可以直接按 "p:sp"、"a:off" 这样的名字查找。
 */
import { SaxesParser } from 'saxes';

export interface XEl {
  name: string;
  attrs: Record<string, string>;
  children: XEl[];
  text: string;
}

const NS: Record<string, string> = {
  'http://schemas.openxmlformats.org/presentationml/2006/main': 'p',
  'http://schemas.openxmlformats.org/drawingml/2006/main': 'a',
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships': 'r',
  'http://schemas.openxmlformats.org/package/2006/relationships': 'rel',
  'http://schemas.openxmlformats.org/package/2006/content-types': 'ct',
  'http://schemas.openxmlformats.org/markup-compatibility/2006': 'mc',
  'http://schemas.openxmlformats.org/drawingml/2006/chart': 'c',
  'http://schemas.openxmlformats.org/drawingml/2006/diagram': 'dgm',
  'http://schemas.microsoft.com/office/drawing/2008/diagram': 'dsp',
  'http://schemas.openxmlformats.org/drawingml/2006/picture': 'pic',
  'http://schemas.microsoft.com/office/powerpoint/2010/main': 'p14',
  'http://schemas.microsoft.com/office/powerpoint/2012/main': 'p15',
  'http://schemas.microsoft.com/office/drawing/2010/main': 'a14',
  'http://schemas.microsoft.com/office/drawing/2014/main': 'a16',
  'http://schemas.openxmlformats.org/officeDocument/2006/math': 'm',
  'http://www.w3.org/XML/1998/namespace': 'xml',
  'http://purl.org/dc/elements/1.1/': 'dc',
  'http://schemas.openxmlformats.org/package/2006/metadata/core-properties': 'cp',
  // Strict 格式的命名空间
  'http://purl.oclc.org/ooxml/presentationml/main': 'p',
  'http://purl.oclc.org/ooxml/drawingml/main': 'a',
  'http://purl.oclc.org/ooxml/officeDocument/relationships': 'r',
  'http://purl.oclc.org/ooxml/drawingml/chart': 'c',
};

/** 元素、属性名：已知的命名空间换成固定前缀；未知的保留文件里的前缀；xml: 不变 */
function qualify(uri: string | undefined, prefix: string, local: string): string {
  if (prefix === 'xml') return `xml:${local}`;
  const fixed = uri ? NS[uri] : undefined;
  if (fixed) return `${fixed}:${local}`;
  return prefix ? `${prefix}:${local}` : local;
}

/**
 * 解析交给 saxes（ISC 许可，周下载量上亿的 SAX 解析器），这里只把事件拼成 XEl 树。
 * 元素里的文字（包括空白）原样累加到 text；格式不规范时（文件被截断、坏字符）不报错，保留已经解析出的部分。
 */
export function parseXml(src: string): XEl {
  const root: XEl = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XEl[] = [root];
  const parser = new SaxesParser({ xmlns: true, position: false });
  parser.on('error', () => { /* 不规范的地方跳过，继续解析 */ });
  parser.on('opentag', (tag) => {
    const el: XEl = { name: qualify(tag.uri, tag.prefix, tag.local), attrs: {}, children: [], text: '' };
    for (const a of Object.values(tag.attributes)) {
      if (a.prefix === 'xmlns' || a.name === 'xmlns') continue;
      // 无前缀属性不属于任何命名空间，保持原名
      el.attrs[a.prefix ? qualify(a.uri, a.prefix, a.local) : a.name] = a.value;
    }
    stack[stack.length - 1].children.push(el);
    stack.push(el);
  });
  parser.on('closetag', () => { if (stack.length > 1) stack.pop(); });
  parser.on('text', (t) => { stack[stack.length - 1].text += t; });
  parser.on('cdata', (t) => { stack[stack.length - 1].text += t; });
  try {
    parser.write(src).close();
  } catch {
    // 截断等情况：保留已经解析出的部分
  }
  return root.children[0] ?? root;
}

// ---------------------------------------------------------------- 查询辅助

export function child(el: XEl | undefined, name: string): XEl | undefined {
  if (!el) return undefined;
  for (const c of el.children) if (c.name === name) return c;
  return undefined;
}

export function children(el: XEl | undefined, name?: string): XEl[] {
  if (!el) return [];
  return name ? el.children.filter((c) => c.name === name) : el.children;
}

/** 按路径找第一个匹配的后代，例如 path(sp, 'p:spPr', 'a:xfrm', 'a:off') */
export function path(el: XEl | undefined, ...names: string[]): XEl | undefined {
  let cur = el;
  for (const n of names) {
    cur = child(cur, n);
    if (!cur) return undefined;
  }
  return cur;
}

export function attr(el: XEl | undefined, name: string): string | undefined {
  return el?.attrs[name];
}

export function numAttr(el: XEl | undefined, name: string): number | undefined {
  const v = el?.attrs[name];
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function boolAttr(el: XEl | undefined, name: string): boolean | undefined {
  const v = el?.attrs[name];
  if (v === undefined) return undefined;
  return v === '1' || v === 'true' || v === 'on';
}

/** 深度优先查找所有匹配的后代 */
export function findAll(el: XEl | undefined, name: string, out: XEl[] = []): XEl[] {
  if (!el) return out;
  for (const c of el.children) {
    if (c.name === name) out.push(c);
    findAll(c, name, out);
  }
  return out;
}

/**
 * 处理 mc:AlternateContent：优先用 mc:Choice（新版 PowerPoint 写的内容），
 * 只认我们理解的命名空间；否则用 mc:Fallback。返回展开后的子元素列表。
 */
const SUPPORTED_REQUIRES = new Set(['p14', 'p15', 'p159', 'a14', 'a16', 'v', 'mc']);
/** 这些命名空间里我们不画的元素：Choice 里出现时改用 Fallback（Office 数学公式、墨迹） */
const UNRENDERED = ['a14:m', 'p14:contentPart', 'p:contentPart'];

export function expandAlternate(list: XEl[]): XEl[] {
  const out: XEl[] = [];
  for (const c of list) {
    if (c.name !== 'mc:AlternateContent') { out.push(c); continue; }
    const choice = c.children.find((x) => x.name === 'mc:Choice'
      && (x.attrs.Requires ?? '').split(/\s+/).every((r) => SUPPORTED_REQUIRES.has(r)));
    const fallback = child(c, 'mc:Fallback');
    // Choice 里有我们画不了的内容（公式、墨迹）时，用 Fallback 里 PowerPoint 存好的图片
    const picked = choice && fallback && UNRENDERED.some((n) => findAll(choice, n).length) ? fallback : choice ?? fallback;
    if (picked) out.push(...expandAlternate(picked.children));
  }
  return out;
}
