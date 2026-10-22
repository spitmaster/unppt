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
export function textEl(txt: string, x: number | number[], y: number | number[], s: RunStyle, family: string, bullet = false, alias?: string, env?: TextEnv, anchor?: string): string {
  const xa = typeof x === 'number' ? n2(x) : x.map(n2).join(' ');
  const ya = typeof y === 'number' ? n2(y) : y.map(n2).join(' ');
  let a = `${bullet ? 'data-bu="1" ' : ''}x="${xa}" y="${ya}" font-family="${esc(fontList(family, alias))}" font-size="${n2(s.size)}" fill="${css(s.color)}"`;
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
  if (env?.doc && s.grad) a = a.replace(/ fill="[^"]*"( fill-opacity="[^"]*")?/, ` fill="${textGradient(s.grad, env)}"`);
  const pic = env && s.blip ? textPicture(s.blip, env) : '';
  if (pic) a = a.replace(/ fill="[^"]*"( fill-opacity="[^"]*")?/, ` fill="${pic}"`);
  const outline = s.outline ? ` stroke="${css(s.outline.color)}" stroke-width="${n2(s.outline.width)}"${s.outline.color.a < 0.999 ? ` stroke-opacity="${n2(s.outline.color.a)}"` : ''}` : '';
  // 人工加粗：描边宽度是字号的 1/56（实测 text-bold-light：按加粗前后笔画浓度的增量对齐）
  const bold = s.fakeBold ? ` stroke="${css(s.color)}" stroke-width="${n2(s.size / 56)}" stroke-linejoin="round"${s.color.a < 0.999 ? ` stroke-opacity="${n2(s.color.a)}"` : ''}` : '';
  const fid = env ? textFilter(s, env) : '';
  const t = esc(txt);
  // 既有轮廓又要人工加粗：轮廓以加粗后的字形边缘为中心（实测 text-outline-fakebold：宋体、楷体粗体加白轮廓，字的颜色基本完整、
  // 白边在外面）。一个 text 只有一种描边，分两层近似：下层轮廓色描边宽 = 加粗宽 + 线宽（外沿对），上层字色描边宽 = 加粗宽 − 线宽（内沿对）
  if (outline && bold && s.outline) {
    const b = s.size / 56, w = s.outline.width;
    const under = outline.replace(/stroke-width="[^"]*"/, `stroke-width="${n2(b + w)}" stroke-linejoin="round"`);
    const top = b - w > 0.05 ? bold.replace(/stroke-width="[^"]*"/, `stroke-width="${n2(b - w)}"`) : '';
    // 线宽比加粗宽大时轮廓的内沿压进字里：再盖一层只有轮廓的
    const inner = w - b > 0.05 ? `<text ${a.replace(/ fill="[^"]*"( fill-opacity="[^"]*")?/, ' fill="none"')}${outline.replace(/stroke-width="[^"]*"/, `stroke-width="${n2(w - b)}"`)} xml:space="preserve">${t}</text>` : '';
    const pair = `<text ${a}${under} xml:space="preserve">${t}</text><text ${a}${top} xml:space="preserve">${t}</text>${inner}`;
    return fid ? `<g filter="url(#${fid})">${pair}</g>` : pair;
  }
  a += outline || bold;
  if (fid) a += ` filter="url(#${fid})"`;
  return `<text ${a} xml:space="preserve">${t}</text>`;
}

/** 渐变、图片填充的文字铺在哪个范围：有行框时按行（横向是这一行文字的宽度、竖向是行高），艺术字变形时铺满整个文本框 */
function fillBox(env: TextEnv): { x: number; y: number; w: number; h: number } {
  const lb = env.lineBox;
  if (lb && lb.w > 0) return lb;
  return { x: 0, y: 0, w: env.gradBox?.w ?? 1, h: env.gradBox?.h ?? 1 };
}

/**
 * 图片填充的文字（a:blipFill 拉伸）：实测（text-picture-fill）和渐变文字一样按行铺——图片拉伸到这一行的外框，
 * 每一行各铺一遍；艺术字变形时铺满整个文本框。返回 url(#编号)；图片解析不到时返回空串（退回文字颜色）。
 */
export function textPicture(blip: XEl, env: TextEnv): string {
  const href = env.blipHrefs?.get(blip);
  if (!href || !env.doc) return '';
  const b = fillBox(env);
  const id = env.doc.id('tp');
  env.doc.addDef(`<pattern id="${id}" patternUnits="userSpaceOnUse" x="${n2(b.x)}" y="${n2(b.y)}" width="${n2(b.w)}" height="${n2(b.h)}"><image href="${esc(href)}" width="${n2(b.w)}" height="${n2(b.h)}" preserveAspectRatio="none"/></pattern>`);
  return `url(#${id})`;
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
  const k = effectScale(s.size);
  const key = `${JSON.stringify(s.effects)}|${bevel?.primitives ?? ''}|${n2(gb.w)}|${n2(gb.h)}|${n2(k)}`;
  let byDoc = textFilters.get(doc);
  if (!byDoc) { byDoc = new Map(); textFilters.set(doc, byDoc); }
  let fid = byDoc.get(key);
  if (fid === undefined) {
    fid = effectFilter(s.effects && scaleEffects(s.effects, k), env.colors, doc, gb.w, gb.h, TEXT_EFFECTS, [bevel]) ?? '';
    byDoc.set(key, fid);
  }
  return fid;
}

/**
 * 文字的外阴影随字号缩放：距离和模糊都乘 (字号 / 72 磅)^(2/3)（size 是像素）。实测（text-shadow-scale、text-shadow-size、
 * text-shadow-dist：Arial 8~200 磅、雅黑 12~96 磅，距离 4~32 磅，向右、向下）：PowerPoint 画的偏移和这个比例吻合到
 * 1~3 像素（8 磅 0.23 倍、72 磅原样、200 磅约 2 倍），和距离成正比；形状的阴影不缩放
 */
function effectScale(size: number): number {
  return Math.pow((size * 0.75) / 72, 2 / 3);
}

/** 效果定义里外阴影的距离、模糊和发光的半径乘 k（其它效果原样） */
function scaleEffects(effects: XEl, k: number): XEl {
  if (Math.abs(k - 1) < 1e-3) return effects;
  const scaled = (el: XEl, names: string[]): XEl => ({ ...el, attrs: { ...el.attrs, ...Object.fromEntries(names.filter((n) => el.attrs[n] !== undefined).map((n) => [n, String(Math.round(Number(el.attrs[n]) * k))])) } });
  return { ...effects, children: effects.children.map((c) => (c.name === 'a:outerShdw' ? scaled(c, ['dist', 'blurRad']) : c.name === 'a:glow' ? scaled(c, ['rad']) : c)) };
}
