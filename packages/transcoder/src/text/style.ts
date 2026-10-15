/** 文字属性：样式链合并（列表样式 -> 段落 -> 文字）、主题字体解析、文字样式 */
import { colorIn, type Rgba } from '../model/color';
import { EMU_PER_PX, type Theme } from '../model/model';
import { linkAttr } from '../common/links';
import { attr, child, numAttr, type XEl } from '../io/xml';
import type { RunStyle, StyleChain, TextEnv } from './types';

/** 东亚字符集：GB2312、Big5、Shift-JIS、韩文（XML 里是有符号数） */
const EA_CHARSETS = new Set(['-122', '-120', '-128', '-127', '134', '136', '128', '129']);

export const GROUP: Record<string, string> = {
  'a:noFill': 'fill', 'a:solidFill': 'fill', 'a:gradFill': 'fill', 'a:blipFill': 'fill', 'a:pattFill': 'fill', 'a:grpFill': 'fill',
  'a:buNone': 'bu', 'a:buChar': 'bu', 'a:buAutoNum': 'bu', 'a:buBlip': 'bu',
  'a:buFont': 'buFont', 'a:buFontTx': 'buFont',
  'a:buClr': 'buClr', 'a:buClrTx': 'buClr',
  'a:buSzPct': 'buSz', 'a:buSzPts': 'buSz', 'a:buSzTx': 'buSz',
};

export function merge(list: (XEl | undefined)[]): XEl {
  const out: XEl = { name: 'merged', attrs: {}, children: [], text: '' };
  const byKey = new Map<string, XEl>();
  for (const el of list) {
    if (!el) continue;
    Object.assign(out.attrs, el.attrs);
    for (const c of el.children) byKey.set(GROUP[c.name] ?? c.name, c);
  }
  out.children = [...byKey.values()];
  return out;
}

export function levelPPr(chain: StyleChain, lvl: number): XEl[] {
  const name = `a:lvl${lvl + 1}pPr`;
  return chain.map((s) => child(s, name)).filter((x): x is XEl => !!x);
}

export function resolveTypeface(tf: string | undefined, theme: Theme): string | undefined {
  if (!tf) return undefined;
  switch (tf) {
    case '+mn-lt': return theme.minorLatin;
    case '+mj-lt': return theme.majorLatin;
    case '+mn-ea': return theme.minorEa || theme.minorLatin;
    case '+mj-ea': return theme.majorEa || theme.majorLatin;
    case '+mn-cs': case '+mj-cs': return theme.minorLatin;
  }
  return tf;
}

function textOutline(ln: XEl | undefined, env: TextEnv): RunStyle['outline'] {
  if (!ln || child(ln, 'a:noFill')) return undefined;
  const c0 = colorIn(child(ln, 'a:solidFill'), env.colors);
  if (!c0) return undefined;
  const c = env.lit3d ? env.lit3d(c0) : c0;
  return { color: c, width: Math.max(0.5, (numAttr(ln, 'w') ?? 12700) / EMU_PER_PX) };
}

export function runStyle(r: XEl, env: TextEnv, scale: number): RunStyle {
  const sz = (numAttr(r, 'sz') ?? 1800) / 100;
  const latin = resolveTypeface(attr(child(r, 'a:latin'), 'typeface'), env.theme) ?? env.theme.minorLatin ?? 'Calibri';
  const ea = resolveTypeface(attr(child(r, 'a:ea'), 'typeface'), env.theme) ?? (env.theme.minorEa || latin);
  const fill = r.children.find((c) => c.name === 'a:solidFill' || c.name === 'a:gradFill' || c.name === 'a:noFill' || c.name === 'a:blipFill');
  let color: Rgba = env.fontRefColor ?? { r: 0, g: 0, b: 0, a: 1 };
  if (fill?.name === 'a:solidFill') color = colorIn(fill, env.colors) ?? color;
  else if (fill?.name === 'a:gradFill') color = colorIn(child(child(fill, 'a:gsLst'), 'a:gs'), env.colors) ?? color;
  else if (fill?.name === 'a:noFill') color = { ...color, a: 0 };
  if (env.lit3d) color = env.lit3d(color);
  let u = attr(r, 'u');
  // 带超链接的文字：PowerPoint 用主题的超链接颜色并加下划线
  const h = child(r, 'a:hlinkClick');
  const link = h && env.rels ? linkAttr(h, env.rels) : '';
  if (link) {
    const hl = colorIn({ name: 'x', attrs: {}, text: '', children: [{ name: 'a:schemeClr', attrs: { val: 'hlink' }, text: '', children: [] }] }, env.colors);
    if (hl) color = hl;
    if (!u || u === 'none') u = 'sng';
  }
  return {
    size: sz * scale * 96 / 72,
    latin, ea,
    sym: resolveTypeface(attr(child(r, 'a:sym'), 'typeface'), env.theme),
    bold: attr(r, 'b') === '1' || attr(r, 'b') === 'true',
    italic: attr(r, 'i') === '1' || attr(r, 'i') === 'true',
    color,
    underline: !!u && u !== 'none',
    uStyle: u && u !== 'none' ? u : undefined,
    strike: !!attr(r, 'strike') && attr(r, 'strike') !== 'noStrike',
    dblStrike: attr(r, 'strike') === 'dblStrike' || undefined,
    highlight: colorIn(child(r, 'a:highlight'), env.colors),
    baseline: (numAttr(r, 'baseline') ?? 0) / 1000,
    // 自动缩小时字间距也按同样比例缩小
    spc: ((numAttr(r, 'spc') ?? 0) / 100) * scale * 96 / 72,
    kern: numAttr(r, 'kern') !== undefined ? numAttr(r, 'kern')! / 100 : undefined,
    caps: (attr(r, 'cap') as RunStyle['caps']) ?? 'none',
    latinEaCharset: EA_CHARSETS.has(attr(child(r, 'a:latin'), 'charset') ?? ''),
    outline: textOutline(child(r, 'a:ln'), env),
    effects: child(r, 'a:effectLst')?.children.length ? child(r, 'a:effectLst') : undefined,
    grad: fill?.name === 'a:gradFill' ? fill : undefined,
    blip: fill?.name === 'a:blipFill' ? fill : undefined,
    link: link || undefined,
  };
}

/** 这段文字是否做字距调整：PowerPoint 只对字号不小于 kern 的文字调整 */
export function kernOn(s: RunStyle): boolean {
  return s.kern !== undefined && s.size * 72 / 96 >= s.kern - 0.01;
}

/** 形状样式（p:style/a:fontRef）的文字颜色做成一个列表样式，插进样式链 */
export function fontRefLevels(c: Rgba): XEl {
  const hex = [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('');
  const clr: XEl = { name: 'a:srgbClr', attrs: { val: hex }, text: '', children: c.a < 1 ? [{ name: 'a:alpha', attrs: { val: String(Math.round(c.a * 100000)) }, text: '', children: [] }] : [] };
  const defRPr: XEl = { name: 'a:defRPr', attrs: {}, text: '', children: [{ name: 'a:solidFill', attrs: {}, text: '', children: [clr] }] };
  const levels: XEl[] = [];
  for (let i = 1; i <= 9; i++) levels.push({ name: `a:lvl${i}pPr`, attrs: {}, text: '', children: [defRPr] });
  return { name: 'a:lstStyle', attrs: {}, text: '', children: levels };
}
