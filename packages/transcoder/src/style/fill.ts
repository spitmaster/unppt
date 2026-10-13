/**
 * 填充（纯色、渐变、图片、图案）-> SVG 属性和 defs；主题样式引用（fillRef / lnRef / effectRef）。
 */
import { colorIn, css, type ColorContext, type Rgba } from '../model/color';
import type { SvgDoc } from '../common/svg';
import { esc, n2 } from '../common/svg';
import { attr, child, children, findAll, numAttr, type XEl } from '../io/xml';
import type { Theme } from '../model/model';
import { blipFilter, parseBlipEffects, type BlipEffects } from './blip';
import { patternFill } from './pattern';

export type Fill =
  | { kind: 'none' }
  | { kind: 'solid'; color: Rgba }
  | { kind: 'grad'; stops: { pos: number; color: Rgba }[]; angle: number; path?: string; rect?: { l: number; t: number; r: number; b: number } }
  | { kind: 'image'; rid: string; part: string; alpha: number; tile: boolean; srcRect?: { l: number; t: number; r: number; b: number }; effects?: BlipEffects }
  | { kind: 'pattern'; prst: string; fg: Rgba; bg: Rgba };

const FILL_NAMES = new Set(['a:noFill', 'a:solidFill', 'a:gradFill', 'a:blipFill', 'a:pattFill', 'a:grpFill']);

export function findFillEl(el: XEl | undefined): XEl | undefined {
  return el?.children.find((c) => FILL_NAMES.has(c.name));
}

/** 解析填充元素。phColor 用于主题样式里的 phClr。part 用于图片关系解析。 */
export function parseFill(f: XEl | undefined, ctx: ColorContext, part: string, groupFill?: Fill): Fill | undefined {
  if (!f) return undefined;
  switch (f.name) {
    case 'a:noFill': return { kind: 'none' };
    case 'a:grpFill': return groupFill ?? { kind: 'none' };
    case 'a:solidFill': {
      const c = colorIn(f, ctx);
      return c ? { kind: 'solid', color: c } : { kind: 'none' };
    }
    case 'a:gradFill': {
      const stops = children(child(f, 'a:gsLst'), 'a:gs')
        .map((g) => ({ pos: (numAttr(g, 'pos') ?? 0) / 100000, color: colorIn(g, ctx) ?? { r: 0, g: 0, b: 0, a: 1 } }))
        .sort((a, b) => a.pos - b.pos);
      const lin = child(f, 'a:lin');
      const p = child(f, 'a:path');
      const ftr = child(p, 'a:fillToRect');
      return {
        kind: 'grad', stops,
        angle: (numAttr(lin, 'ang') ?? 0) / 60000,
        path: p ? (attr(p, 'path') ?? 'circle') : undefined,
        rect: ftr ? {
          l: (numAttr(ftr, 'l') ?? 0) / 100000, t: (numAttr(ftr, 't') ?? 0) / 100000,
          r: (numAttr(ftr, 'r') ?? 0) / 100000, b: (numAttr(ftr, 'b') ?? 0) / 100000,
        } : undefined,
      };
    }
    case 'a:blipFill': {
      const blip = child(f, 'a:blip');
      // PowerPoint 插入的 SVG 图片同时存了 PNG 备用图和原始 SVG（asvg:svgBlip）：用 SVG，放大不糊
      const rid = attr(findAll(blip, 'asvg:svgBlip')[0], 'r:embed') ?? attr(blip, 'r:embed') ?? '';
      const amf = child(blip, 'a:alphaModFix');
      const sr = child(f, 'a:srcRect');
      return {
        kind: 'image', rid, part, alpha: (numAttr(amf, 'amt') ?? 100000) / 100000, tile: !!child(f, 'a:tile'),
        effects: parseBlipEffects(blip, ctx),
        srcRect: sr ? {
          l: (numAttr(sr, 'l') ?? 0) / 100000, t: (numAttr(sr, 't') ?? 0) / 100000,
          r: (numAttr(sr, 'r') ?? 0) / 100000, b: (numAttr(sr, 'b') ?? 0) / 100000,
        } : undefined,
      };
    }
    case 'a:pattFill': {
      const fg = colorIn(child(f, 'a:fgClr'), ctx) ?? { r: 0, g: 0, b: 0, a: 1 };
      const bg = colorIn(child(f, 'a:bgClr'), ctx) ?? { r: 255, g: 255, b: 255, a: 1 };
      return { kind: 'pattern', prst: attr(f, 'prst') ?? 'pct5', fg, bg };
    }
  }
  return undefined;
}

/** p:style 里的 fillRef / lnRef / effectRef：从主题样式表里取，phClr 用引用自带的颜色 */
export function styleRef(ref: XEl | undefined, list: XEl[], ctx: ColorContext): { el?: XEl; ctx: ColorContext } {
  if (!ref) return { ctx };
  const idx = numAttr(ref, 'idx') ?? 0;
  const color = colorIn(ref, ctx);
  const sub: ColorContext = { ...ctx, placeholder: color };
  if (idx <= 0) return { ctx: sub };
  return { el: list[idx - 1], ctx: sub };
}

export function bgStyle(theme: Theme, idx: number): XEl | undefined {
  if (idx >= 1001) return theme.bgFillStyles[idx - 1001];
  if (idx >= 1) return theme.fillStyles[idx - 1];
  return undefined;
}

function mix(c: Rgba, to: number, amt: number): Rgba {
  return { r: Math.round(c.r + (to - c.r) * amt), g: Math.round(c.g + (to - c.g) * amt), b: Math.round(c.b + (to - c.b) * amt), a: c.a };
}

/** 路径的 fill 模式（lighten / darken 等）对颜色做调整 */
export function adjustForPathMode(c: Rgba, mode: string): Rgba {
  switch (mode) {
    case 'lighten': return mix(c, 255, 0.4);
    case 'lightenLess': return mix(c, 255, 0.2);
    case 'darken': return mix(c, 0, 0.4);
    case 'darkenLess': return mix(c, 0, 0.2);
    default: return c;
  }
}

export interface ImageResolver {
  /** 返回图片的 href（data URI 或相对路径）；不支持的格式返回 undefined */
  image(part: string, rid: string): Promise<string | undefined>;
}

/**
 * 生成 fill 属性。w/h 是形状尺寸（像素），用于渐变方向和图片填充；
 * origin 是元素坐标原点在幻灯片上的位置（图案填充从幻灯片原点对齐）。
 * 返回形如 ` fill="#fff" fill-opacity="0.5"` 的字符串。
 */
export async function fillAttrs(
  fill: Fill | undefined, doc: SvgDoc, w: number, h: number, mode: string, images: ImageResolver,
  origin?: { x: number; y: number },
): Promise<string> {
  if (!fill || fill.kind === 'none') return ' fill="none"';
  if (fill.kind === 'pattern' && mode === 'norm') {
    const id = patternFill(doc, fill.prst, fill.fg, fill.bg, origin);
    if (id) return ` fill="url(#${id})"`;
  }
  if (fill.kind === 'solid' || fill.kind === 'pattern') {
    let c = fill.kind === 'solid' ? fill.color : mix(fill.fg, fill.bg.r, 0.5);
    c = adjustForPathMode(c, mode);
    return ` fill="${css(c)}"${c.a < 0.999 ? ` fill-opacity="${n2(c.a)}"` : ''}`;
  }
  if (fill.kind === 'grad') {
    const id = doc.id('g');
    const stops = fill.stops.map((s) => {
      const c = adjustForPathMode(s.color, mode);
      return `<stop offset="${n2(s.pos)}" stop-color="${css(c)}"${c.a < 0.999 ? ` stop-opacity="${n2(c.a)}"` : ''}/>`;
    }).join('');
    if (fill.path) {
      const r = fill.rect ?? { l: 0.5, t: 0.5, r: 0.5, b: 0.5 };
      const cx = (r.l + (1 - r.r)) / 2 * w;
      const cy = (r.t + (1 - r.b)) / 2 * h;
      const rad = Math.sqrt(Math.max(cx, w - cx) ** 2 + Math.max(cy, h - cy) ** 2);
      doc.addDef(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${n2(cx)}" cy="${n2(cy)}" r="${n2(rad)}">${stops}</radialGradient>`);
    } else {
      const a = fill.angle * Math.PI / 180;
      const dx = Math.cos(a), dy = Math.sin(a);
      const cx = w / 2, cy = h / 2;
      // 让四个角在渐变方向上的投影刚好落在 0..1
      const proj = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => (x - cx) * dx + (y - cy) * dy);
      const lo = Math.min(...proj), hi = Math.max(...proj);
      doc.addDef(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n2(cx + dx * lo)}" y1="${n2(cy + dy * lo)}" x2="${n2(cx + dx * hi)}" y2="${n2(cy + dy * hi)}">${stops}</linearGradient>`);
    }
    return ` fill="url(#${id})"`;
  }
  // 图片填充：用 pattern 把图片拉伸到形状框
  const href = await images.image(fill.part, fill.rid);
  if (!href) return ' fill="#d9d9d9"';
  const id = doc.id('p');
  const sr = fill.srcRect ?? { l: 0, t: 0, r: 0, b: 0 };
  const iw = w / Math.max(0.0001, 1 - sr.l - sr.r);
  const ih = h / Math.max(0.0001, 1 - sr.t - sr.b);
  const fid = blipFilter(fill.effects, doc);
  doc.addDef(`<pattern id="${id}" patternUnits="userSpaceOnUse" width="${n2(w)}" height="${n2(h)}"><image href="${esc(href)}" x="${n2(-sr.l * iw)}" y="${n2(-sr.t * ih)}" width="${n2(iw)}" height="${n2(ih)}" preserveAspectRatio="none"${fill.alpha < 1 ? ` opacity="${n2(fill.alpha)}"` : ''}${fid ? ` filter="url(#${fid})"` : ''}/></pattern>`);
  return ` fill="url(#${id})"`;
}
