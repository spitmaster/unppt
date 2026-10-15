/** 输出：一段同样式的文字 -> SVG <text>（字体、颜色、装饰线、描边、渐变、阴影、超链接） */
import { colorIn, css } from '../model/color';
import { esc, n2 } from '../common/svg';
import { effectFilter } from '../effects/effect-filter';
import { gradientStops } from '../style/gradient-stops';
import { bevelLayer } from '../effects/bevel';
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

/**
 * x 是起点，或者每个字的位置（逐字定位：字按排版时算的位置落下，不用浏览器自己的字宽，字距、字间距都已经算在位置里）
 */
export function textEl(txt: string, x: number | number[], y: number, s: RunStyle, family: string, bullet = false, alias?: string, env?: TextEnv, anchor?: string): string {
  const xa = typeof x === 'number' ? n2(x) : x.map(n2).join(' ');
  let a = `${bullet ? 'data-bu="1" ' : ''}x="${xa}" y="${n2(y)}" font-family="${esc(fontList(family, alias))}" font-size="${n2(s.size)}" fill="${css(s.color)}"`;
  if (s.color.a < 0.999) a += ` fill-opacity="${n2(s.color.a)}"`;
  if (s.bold) a += ' font-weight="bold"';
  if (s.italic) a += ' font-style="italic"';
  if (s.spc && typeof x === 'number') a += ` letter-spacing="${n2(s.spc)}"`;
  if (anchor) a += ` text-anchor="${anchor}"`;
  const css2: string[] = [];
  if (s.link) { a += s.link; css2.push('cursor:pointer'); }
  // 浏览器默认会做字距调整；PowerPoint 没开的地方关掉，保持和排版时算的宽度一致
  if (!kernOn(s)) css2.push('font-kerning:none');
  if (css2.length) a += ` style="${css2.join(';')}"`;
  if (s.outline) a += ` stroke="${css(s.outline.color)}" stroke-width="${n2(s.outline.width)}"${s.outline.color.a < 0.999 ? ` stroke-opacity="${n2(s.outline.color.a)}"` : ''}`;
  // 人工加粗：描边宽度是字号的 1/56（实测 text-bold-light：按加粗前后笔画浓度的增量对齐）
  else if (s.fakeBold) a += ` stroke="${css(s.color)}" stroke-width="${n2(s.size / 56)}" stroke-linejoin="round"${s.color.a < 0.999 ? ` stroke-opacity="${n2(s.color.a)}"` : ''}`;
  if (env?.doc && s.grad) a = a.replace(/ fill="[^"]*"( fill-opacity="[^"]*")?/, ` fill="${textGradient(s.grad, env)}"`);
  const fid = env ? textFilter(s, env) : '';
  if (fid) a += ` filter="url(#${fid})"`;
  return `<text ${a} xml:space="preserve">${esc(txt)}</text>`;
}

/**
 * 渐变文字的填充（userSpaceOnUse），返回 url(#编号)。实测（硬边渐变量色标的位置，Arial / 雅黑 / 等线 20~80 磅，竖向、横向）：
 * 每一行各自铺一遍渐变（两行文字各自从头开始），范围正好是这一行的外框——横向是这一行文字的宽度、竖向是行高，
 * 和文本框多高无关；艺术字变形（没有行框）时铺满整个文本框
 */
export function textGradient(grad: XEl, env: TextEnv): string {
  const doc = env.doc!;
  const id = doc.id('tg');
  const ang = ((numAttr(child(grad, 'a:lin'), 'ang') ?? 0) / 60000) * Math.PI / 180;
  const lb = env.lineBox;
  const box = lb && lb.w > 0
    ? { cx: lb.x + lb.w / 2, cy: lb.y + lb.h / 2, w: lb.w, h: lb.h }
    : { cx: (env.gradBox?.w ?? 1) / 2, cy: (env.gradBox?.h ?? 1) / 2, w: env.gradBox?.w ?? 1, h: env.gradBox?.h ?? 1 };
  const dx = (Math.cos(ang) / 2) * box.w, dy = (Math.sin(ang) / 2) * box.h;
  const stops = gradientStops(children(child(grad, 'a:gsLst'), 'a:gs').map((g) => ({
    pos: (numAttr(g, 'pos') ?? 0) / 100000, color: colorIn(g, env.colors) ?? { r: 0, g: 0, b: 0, a: 1 },
  })), env.lit3d);
  doc.addDef(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n2(box.cx - dx)}" y1="${n2(box.cy - dy)}" x2="${n2(box.cx + dx)}" y2="${n2(box.cy + dy)}">${stops}</linearGradient>`);
  return `url(#${id})`;
}

/**
 * 文字效果（阴影、发光、内阴影、三维棱台）：和形状效果用同一套滤镜（ShapeEffect），滤镜区域取文本框；
 * 同一页里同样的效果只生成一个。返回滤镜编号，没有效果时返回空串。映像由 emit.ts 按行处理。
 */
export function textFilter(s: RunStyle, env: TextEnv): string {
  const doc = env.doc;
  const bevel = bevelLayer(env.sp3d);
  if (!doc || (!s.effects && !bevel)) return '';
  const gb = env.gradBox ?? { w: 1, h: 1 };
  const key = `${JSON.stringify(s.effects)}|${bevel?.primitives ?? ''}|${n2(gb.w)}|${n2(gb.h)}`;
  let byDoc = textFilters.get(doc);
  if (!byDoc) { byDoc = new Map(); textFilters.set(doc, byDoc); }
  let fid = byDoc.get(key);
  if (fid === undefined) {
    fid = effectFilter(s.effects, env.colors, doc, gb.w, gb.h, TEXT_EFFECTS, [bevel]) ?? '';
    byDoc.set(key, fid);
  }
  return fid;
}
