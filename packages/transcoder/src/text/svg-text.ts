/** 输出：一段同样式的文字 -> SVG <text>（字体、颜色、装饰线、描边、渐变、阴影、超链接） */
import { colorIn, css } from '../model/color';
import { esc, n2 } from '../common/svg';
import { effectFilter } from '../effects/effect-filter';
import { TEXT_EFFECTS } from '../effects/effects';
import type { SvgDoc } from '../common/svg';

/** 同一页里同样的文字效果只生成一个滤镜 */
const textFilters = new WeakMap<SvgDoc, Map<string, string>>();
import { child, children, numAttr, type XEl } from '../io/xml';
import { kernOn } from './style';
import type { RunStyle, TextEnv } from './types';

/** 只写测量时实际用的字体：保证浏览器显示的字宽和转码时算的一致 */
function fontList(primary: string, alias?: string): string {
  return `${alias ? `'${alias}',` : ''}'${primary.replace(/'/g, '')}',sans-serif`;
}

export function textEl(txt: string, x: number, y: number, s: RunStyle, family: string, bullet = false, alias?: string, env?: TextEnv, anchor?: string): string {
  let a = `${bullet ? 'data-bu="1" ' : ''}x="${n2(x)}" y="${n2(y)}" font-family="${esc(fontList(family, alias))}" font-size="${n2(s.size)}" fill="${css(s.color)}"`;
  if (s.color.a < 0.999) a += ` fill-opacity="${n2(s.color.a)}"`;
  if (s.bold) a += ' font-weight="bold"';
  if (s.italic) a += ' font-style="italic"';
  if (s.spc) a += ` letter-spacing="${n2(s.spc)}"`;
  if (anchor) a += ` text-anchor="${anchor}"`;
  const css2: string[] = [];
  if (s.link) { a += s.link; css2.push('cursor:pointer'); }
  // 浏览器默认会做字距调整；PowerPoint 没开的地方关掉，保持和排版时算的宽度一致
  if (!kernOn(s)) css2.push('font-kerning:none');
  if (css2.length) a += ` style="${css2.join(';')}"`;
  if (s.outline) a += ` stroke="${css(s.outline.color)}" stroke-width="${n2(s.outline.width)}"${s.outline.color.a < 0.999 ? ` stroke-opacity="${n2(s.outline.color.a)}"` : ''}`;
  if (env?.doc && s.grad) a = a.replace(/ fill="[^"]*"( fill-opacity="[^"]*")?/, ` fill="${textGradient(s.grad, env)}"`);
  const fid = env ? textFilter(s, env) : '';
  if (fid) a += ` filter="url(#${fid})"`;
  return `<text ${a} xml:space="preserve">${esc(txt)}</text>`;
}

/** 渐变文字的填充：渐变铺满整个文本框（userSpaceOnUse），返回 url(#编号) */
export function textGradient(grad: XEl, env: TextEnv): string {
  const doc = env.doc!;
  const id = doc.id('tg');
  const ang = ((numAttr(child(grad, 'a:lin'), 'ang') ?? 0) / 60000) * Math.PI / 180;
  const gb = env.gradBox ?? { w: 1, h: 1 };
  const dx = Math.cos(ang) / 2, dy = Math.sin(ang) / 2;
  const stops = children(child(grad, 'a:gsLst'), 'a:gs').map((g) => {
    const c = colorIn(g, env.colors) ?? { r: 0, g: 0, b: 0, a: 1 };
    return `<stop offset="${n2((numAttr(g, 'pos') ?? 0) / 100000)}" stop-color="${css(c)}"${c.a < 0.999 ? ` stop-opacity="${n2(c.a)}"` : ''}/>`;
  }).join('');
  doc.addDef(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n2((0.5 - dx) * gb.w)}" y1="${n2((0.5 - dy) * gb.h)}" x2="${n2((0.5 + dx) * gb.w)}" y2="${n2((0.5 + dy) * gb.h)}">${stops}</linearGradient>`);
  return `url(#${id})`;
}

/**
 * 文字效果（阴影、发光、内阴影）：和形状效果用同一套滤镜（ShapeEffect），滤镜区域取文本框；
 * 同一页里同样的效果只生成一个。返回滤镜编号，没有效果时返回空串。映像由 emit.ts 按行处理。
 */
export function textFilter(s: RunStyle, env: TextEnv): string {
  const doc = env.doc;
  if (!doc || !s.effects) return '';
  const gb = env.gradBox ?? { w: 1, h: 1 };
  const key = `${JSON.stringify(s.effects)}|${n2(gb.w)}|${n2(gb.h)}`;
  let byDoc = textFilters.get(doc);
  if (!byDoc) { byDoc = new Map(); textFilters.set(doc, byDoc); }
  let fid = byDoc.get(key);
  if (fid === undefined) {
    fid = effectFilter(s.effects, env.colors, doc, gb.w, gb.h, TEXT_EFFECTS) ?? '';
    byDoc.set(key, fid);
  }
  return fid;
}
