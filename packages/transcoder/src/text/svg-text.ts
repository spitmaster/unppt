/** 输出：一段同样式的文字 -> SVG <text>（字体、颜色、装饰线、描边、渐变、阴影、超链接） */
import { colorIn, css } from '../model/color';
import { esc, n2 } from '../common/svg';
import { shadowFilter } from '../effects/text-shadow';
import { child, children, numAttr } from '../io/xml';
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
  const doc = env?.doc;
  if (doc && s.grad) {
    const id = doc.id('tg');
    const ang = ((numAttr(child(s.grad, 'a:lin'), 'ang') ?? 0) / 60000) * Math.PI / 180;
    const gb = env!.gradBox ?? { w: 1, h: 1 };
    const dx = Math.cos(ang) / 2, dy = Math.sin(ang) / 2;
    const stops = children(child(s.grad, 'a:gsLst'), 'a:gs').map((g) => {
      const c = colorIn(g, env!.colors) ?? { r: 0, g: 0, b: 0, a: 1 };
      return `<stop offset="${n2((numAttr(g, 'pos') ?? 0) / 100000)}" stop-color="${css(c)}"${c.a < 0.999 ? ` stop-opacity="${n2(c.a)}"` : ''}/>`;
    }).join('');
    doc.addDef(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n2((0.5 - dx) * gb.w)}" y1="${n2((0.5 - dy) * gb.h)}" x2="${n2((0.5 + dx) * gb.w)}" y2="${n2((0.5 + dy) * gb.h)}">${stops}</linearGradient>`);
    a = a.replace(/ fill="[^"]*"( fill-opacity="[^"]*")?/, ` fill="url(#${id})"`);
  }
  if (doc && s.shadow && env) {
    const fid = shadowFilter({ name: 'a:effectLst', attrs: {}, text: '', children: [s.shadow] }, env.colors, doc);
    if (fid) a += ` filter="url(#${fid})"`;
  }
  return `<text ${a} xml:space="preserve">${esc(txt)}</text>`;
}
