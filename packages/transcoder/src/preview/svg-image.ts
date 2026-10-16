/**
 * 出图时要展开进页面的 SVG 图片（prepare.ts inlineSvgImages）：拆出根元素的属性和内容。
 * 外部 SVG（例如 Illustrator 导出的）常带 XML 声明、注释、DOCTYPE，DOCTYPE 里定义实体（&ns_svg; 之类），根元素上声明
 * xmlns:xlink、xmlns:i 等前缀。原样把内容塞进页面时，实体和前缀都找不到定义，resvg 会整页解析失败（实测），所以：
 *   - 跳过序言（XML 声明、注释、处理指令、DOCTYPE）和结尾的注释；
 *   - DOCTYPE 里 <!ENTITY 名 "值"> 这种简单实体展开；还有别的实体引用（不认识的）时不展开这张图（只丢这张，不连累整页）；
 *   - 根元素上的 xmlns:前缀 声明交给调用方带到嵌套的 svg 上。
 */
export interface SvgImageParts {
  /** 根元素的属性原文（实体已展开） */
  attrs: string;
  /** 根元素的内容（实体已展开） */
  body: string;
  /** 根元素上的前缀声明，形如 ` xmlns:xlink="…"` */
  ns: string;
}

const PROLOG = /^﻿?\s*((?:<\?[\s\S]*?\?>\s*|<!--[\s\S]*?-->\s*|<!DOCTYPE\b[^[>]*(?:\[[\s\S]*?\])?\s*>\s*)*)<svg\b([^>]*)>([\s\S]*)<\/svg>\s*(?:<!--[\s\S]*?-->\s*)*$/;
const PREDEFINED = new Set(['amp', 'lt', 'gt', 'quot', 'apos']);

export function svgImageParts(text: string): SvgImageParts | undefined {
  const m = PROLOG.exec(text);
  if (!m) return undefined;
  const entities = new Map<string, string>();
  for (const [, name, a, b] of m[1].matchAll(/<!ENTITY\s+([\w.:-]+)\s+(?:"([^"]*)"|'([^']*)')\s*>/g)) entities.set(name, a ?? b ?? '');
  const expand = (s: string): string | undefined => {
    let out = s;
    // 实体的值里还可以引用别的实体：最多展开几层
    for (let i = 0; i < 4 && /&[\w.:-]+;/.test(out); i++) out = out.replace(/&([\w.:-]+);/g, (r, n: string) => entities.get(n) ?? r);
    for (const [, n] of out.matchAll(/&([\w.:-]+);/g)) if (!PREDEFINED.has(n)) return undefined;
    return out;
  };
  const attrs = expand(m[2]), body = expand(m[3]);
  if (attrs === undefined || body === undefined) return undefined;
  const ns = [...attrs.matchAll(/\sxmlns:[\w.-]+=(?:"[^"]*"|'[^']*')/g)].map((x) => x[0]).join('');
  return { attrs, body, ns };
}
