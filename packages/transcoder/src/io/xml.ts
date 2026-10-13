/**
 * 精简的 XML 解析器，专为 OOXML 设计（格式规范、无 DTD）。
 *
 * 命名空间会被换成固定前缀（p:、a:、r: 等），不管文件里实际用的是什么前缀，
 * 后面的代码都可以直接按 "p:sp"、"a:off" 这样的名字查找。
 */

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

function decodeEntities(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_, e: string) => {
    switch (e) {
      case 'lt': return '<';
      case 'gt': return '>';
      case 'amp': return '&';
      case 'quot': return '"';
      case 'apos': return "'";
    }
    const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : '';
  });
}

interface Scope { map: Map<string, string>; }

function resolveName(qname: string, scopes: Scope[], isAttr: boolean): string {
  const colon = qname.indexOf(':');
  if (colon < 0) {
    if (isAttr) return qname; // 无前缀属性不属于任何命名空间
    for (let i = scopes.length - 1; i >= 0; i--) {
      const uri = scopes[i].map.get('');
      if (uri !== undefined) return NS[uri] ? `${NS[uri]}:${qname}` : qname;
    }
    return qname;
  }
  const prefix = qname.slice(0, colon);
  const local = qname.slice(colon + 1);
  if (prefix === 'xml') return `xml:${local}`;
  for (let i = scopes.length - 1; i >= 0; i--) {
    const uri = scopes[i].map.get(prefix);
    if (uri !== undefined) return `${NS[uri] ?? prefix}:${local}`;
  }
  return qname;
}

const ATTR_RE = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

export function parseXml(src: string): XEl {
  const root: XEl = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XEl[] = [root];
  const scopes: Scope[] = [{ map: new Map() }];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i) {
      const top = stack[stack.length - 1];
      top.text += decodeEntities(src.slice(i, lt));
    }
    // 找不到结尾（文件被截断）时直接结束，不能把 -1 当位置用，否则会死循环
    const skipTo = (token: string, from: number) => {
      const k = src.indexOf(token, from);
      return k < 0 ? n : k + token.length;
    };
    if (src.startsWith('<?', lt)) { i = skipTo('?>', lt); continue; }
    if (src.startsWith('<!--', lt)) { i = skipTo('-->', lt); continue; }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt);
      stack[stack.length - 1].text += src.slice(lt + 9, end < 0 ? n : end);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (src.startsWith('<!', lt)) { i = skipTo('>', lt); continue; }
    if (src[lt + 1] === '/') {
      if (stack.length > 1) { stack.pop(); scopes.pop(); }
      i = skipTo('>', lt);
      continue;
    }
    // 开始标签：找到真正的 '>'（属性值里可能有 '>'）
    let j = lt + 1;
    let quote = '';
    for (; j < n; j++) {
      const c = src[j];
      if (quote) { if (c === quote) quote = ''; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
    }
    const selfClose = src[j - 1] === '/';
    const body = src.slice(lt + 1, selfClose ? j - 1 : j);
    const sp = body.search(/\s/);
    const qname = sp < 0 ? body : body.slice(0, sp);
    const rawAttrs: [string, string][] = [];
    const scope: Scope = { map: new Map() };
    if (sp >= 0) {
      ATTR_RE.lastIndex = 0;
      const attrSrc = body.slice(sp);
      let m: RegExpExecArray | null;
      while ((m = ATTR_RE.exec(attrSrc))) {
        const k = m[1];
        const v = decodeEntities(m[3] ?? m[4] ?? '');
        if (k === 'xmlns') scope.map.set('', v);
        else if (k.startsWith('xmlns:')) scope.map.set(k.slice(6), v);
        else rawAttrs.push([k, v]);
      }
    }
    scopes.push(scope);
    const el: XEl = { name: resolveName(qname, scopes, false), attrs: {}, children: [], text: '' };
    for (const [k, v] of rawAttrs) el.attrs[resolveName(k, scopes, true)] = v;
    stack[stack.length - 1].children.push(el);
    if (selfClose) scopes.pop();
    else stack.push(el);
    i = j + 1;
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
const SUPPORTED_REQUIRES = new Set(['p14', 'p15', 'a14', 'a16', 'v', 'mc']);

export function expandAlternate(list: XEl[]): XEl[] {
  const out: XEl[] = [];
  for (const c of list) {
    if (c.name !== 'mc:AlternateContent') { out.push(c); continue; }
    const choice = c.children.find((x) => x.name === 'mc:Choice'
      && (x.attrs.Requires ?? '').split(/\s+/).every((r) => SUPPORTED_REQUIRES.has(r)));
    const fallback = child(c, 'mc:Fallback');
    // 公式（a14:m）我们不排版，用 Fallback 里 PowerPoint 存好的公式图片
    const picked = choice && fallback && findAll(choice, 'a14:m').length ? fallback : choice ?? fallback;
    if (picked) out.push(...expandAlternate(picked.children));
  }
  return out;
}
