/**
 * 填充、线条、阴影 -> SVG 属性和 defs。
 */
import { colorIn, css, parseColorEl, type ColorContext, type Rgba } from './color';
import type { SvgDoc } from './svg';
import { esc, n2 } from './svg';
import { attr, child, children, numAttr, type XEl } from './xml';
import { EMU_PER_PX, type Theme } from './model';

export type Fill =
  | { kind: 'none' }
  | { kind: 'solid'; color: Rgba }
  | { kind: 'grad'; stops: { pos: number; color: Rgba }[]; angle: number; path?: string; rect?: { l: number; t: number; r: number; b: number } }
  | { kind: 'image'; rid: string; part: string; alpha: number; tile: boolean; srcRect?: { l: number; t: number; r: number; b: number }; effects?: BlipEffects }
  | { kind: 'pattern'; fg: Rgba; bg: Rgba };

/** 图片调整：双色调、灰度、亮度对比度、某种颜色变透明 */
export interface BlipEffects {
  duotone?: [Rgba, Rgba];
  grayscale?: boolean;
  bright?: number;     // -1..1
  contrast?: number;   // -1..1
  clrChange?: Rgba;    // 变透明的颜色
}

export function parseBlipEffects(blip: XEl | undefined, ctx: ColorContext): BlipEffects | undefined {
  if (!blip) return undefined;
  const e: BlipEffects = {};
  const duo = child(blip, 'a:duotone');
  if (duo) {
    const cs = duo.children.map((c) => parseColorEl(c, ctx)).filter((c): c is Rgba => !!c);
    if (cs.length >= 2) e.duotone = [cs[0], cs[1]];
  }
  if (child(blip, 'a:grayscl')) e.grayscale = true;
  const lum = child(blip, 'a:lum');
  if (lum) {
    e.bright = (numAttr(lum, 'bright') ?? 0) / 100000;
    e.contrast = (numAttr(lum, 'contrast') ?? 0) / 100000;
  }
  const cc = child(blip, 'a:clrChange');
  if (cc) e.clrChange = colorIn(child(cc, 'a:clrFrom'), ctx);
  return Object.keys(e).length ? e : undefined;
}

const f01 = (v: number) => (Math.round(v / 255 * 1000) / 1000).toString();

/** 图片调整 -> SVG filter，返回 filter id */
export function blipFilter(e: BlipEffects | undefined, doc: SvgDoc): string | undefined {
  if (!e) return undefined;
  const parts: string[] = [];
  // clrChange（某种颜色变透明）暂未实现：需要按颜色距离生成透明度，SVG 滤镜表达较复杂
  if (e.grayscale || e.duotone) {
    parts.push('<feColorMatrix type="matrix" values="0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0 0 0 1 0"/>');
  }
  if (e.duotone) {
    const [a, b] = e.duotone;
    parts.push(`<feComponentTransfer><feFuncR type="table" tableValues="${f01(a.r)} ${f01(b.r)}"/><feFuncG type="table" tableValues="${f01(a.g)} ${f01(b.g)}"/><feFuncB type="table" tableValues="${f01(a.b)} ${f01(b.b)}"/></feComponentTransfer>`);
  }
  if (e.bright || e.contrast) {
    const k = 1 + (e.contrast ?? 0);
    const off = (e.bright ?? 0) + (1 - k) / 2;
    parts.push(`<feComponentTransfer><feFuncR type="linear" slope="${k}" intercept="${off}"/><feFuncG type="linear" slope="${k}" intercept="${off}"/><feFuncB type="linear" slope="${k}" intercept="${off}"/></feComponentTransfer>`);
  }
  if (!parts.length) return undefined;
  const id = doc.id('b');
  doc.addDef(`<filter id="${id}" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%">${parts.join('')}</filter>`);
  return id;
}

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
      const rid = attr(blip, 'r:embed') ?? '';
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
      return { kind: 'pattern', fg, bg };
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
 * 生成 fill 属性。w/h 是形状尺寸（像素），用于渐变方向和图片填充。
 * 返回形如 ` fill="#fff" fill-opacity="0.5"` 的字符串。
 */
export async function fillAttrs(fill: Fill | undefined, doc: SvgDoc, w: number, h: number, mode: string, images: ImageResolver): Promise<string> {
  if (!fill || fill.kind === 'none') return ' fill="none"';
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

// ---------------------------------------------------------------- 线条

export interface Line {
  color?: Rgba;
  fill?: Fill;
  width: number;     // 像素
  dash?: string;
  cap: string;
  join: string;
  head?: { type: string; w: string; len: string };
  tail?: { type: string; w: string; len: string };
}

const DASH: Record<string, number[]> = {
  dash: [4, 3], sysDash: [3, 1], dot: [1, 1], sysDot: [1, 1], lgDash: [8, 3], dashDot: [4, 3, 1, 3],
  lgDashDot: [8, 3, 1, 3], lgDashDotDot: [8, 3, 1, 3, 1, 3], sysDashDot: [3, 1, 1, 1], sysDashDotDot: [3, 1, 1, 1, 1, 1],
};

/** 合并线条定义（主题样式 -> 形状自己的 a:ln），返回最终线条；noFill 返回 undefined */
export function parseLine(lns: (XEl | undefined)[], ctxs: ColorContext[], part: string): Line | undefined {
  let width = 9525;
  let fill: Fill | undefined;
  let dash: string | undefined;
  let cap = 'flat', join = 'round';
  let head, tail;
  let any = false;
  lns.forEach((ln, i) => {
    if (!ln) return;
    any = true;
    const w = numAttr(ln, 'w');
    if (w !== undefined) width = w;
    const f = parseFill(findFillEl(ln), ctxs[i], part);
    if (f) fill = f;
    const pd = attr(child(ln, 'a:prstDash'), 'val');
    if (pd) dash = pd;
    const c = attr(ln, 'cap');
    if (c) cap = c;
    if (child(ln, 'a:round')) join = 'round';
    else if (child(ln, 'a:bevel')) join = 'bevel';
    else if (child(ln, 'a:miter')) join = 'miter';
    const he = child(ln, 'a:headEnd');
    if (he) head = { type: attr(he, 'type') ?? 'none', w: attr(he, 'w') ?? 'med', len: attr(he, 'len') ?? 'med' };
    const te = child(ln, 'a:tailEnd');
    if (te) tail = { type: attr(te, 'type') ?? 'none', w: attr(te, 'w') ?? 'med', len: attr(te, 'len') ?? 'med' };
  });
  if (!any || !fill || fill.kind === 'none') return undefined;
  const px = Math.max(width / EMU_PER_PX, width > 0 ? 0.5 : 0);
  const color = fill.kind === 'solid' ? fill.color : fill.kind === 'grad' ? fill.stops[0]?.color : undefined;
  return {
    color, fill, width: px,
    dash: dash && dash !== 'solid' && DASH[dash] ? DASH[dash].map((d) => n2(d * px)).join(' ') : undefined,
    cap: cap === 'rnd' ? 'round' : cap === 'sq' ? 'square' : 'butt',
    join, head, tail,
  };
}

function markerSize(sz: string) {
  return sz === 'sm' ? 2 : sz === 'lg' ? 5 : 3;
}

function marker(doc: SvgDoc, end: { type: string; w: string; len: string }, color: string, isStart: boolean): string | undefined {
  if (end.type === 'none') return undefined;
  const id = doc.id('m');
  const mw = markerSize(end.w), ml = markerSize(end.len);
  let shape: string;
  switch (end.type) {
    case 'oval': shape = `<ellipse cx="${ml / 2}" cy="${mw / 2}" rx="${ml / 2}" ry="${mw / 2}"/>`; break;
    case 'diamond': shape = `<path d="M0 ${mw / 2}L${ml / 2} 0L${ml} ${mw / 2}L${ml / 2} ${mw}Z"/>`; break;
    case 'arrow': shape = `<path d="M0 0L${ml} ${mw / 2}L0 ${mw}" fill="none" stroke="${color}" stroke-width="0.6"/>`; break;
    case 'stealth': shape = `<path d="M0 0L${ml} ${mw / 2}L0 ${mw}L${ml * 0.3} ${mw / 2}Z"/>`; break;
    default: shape = `<path d="M0 0L${ml} ${mw / 2}L0 ${mw}Z"/>`;
  }
  doc.addDef(`<marker id="${id}" viewBox="0 0 ${ml} ${mw}" refX="${ml * 0.8}" refY="${mw / 2}" markerWidth="${ml}" markerHeight="${mw}" orient="${isStart ? 'auto-start-reverse' : 'auto'}" fill="${color}">${shape}</marker>`);
  return id;
}

export function strokeAttrs(line: Line | undefined, doc: SvgDoc, mode: string): string {
  if (!line) return ' stroke="none"';
  const c = adjustForPathMode(line.color ?? { r: 0, g: 0, b: 0, a: 1 }, mode === 'norm' ? '' : '');
  let s = ` stroke="${css(c)}" stroke-width="${n2(line.width)}"`;
  if (c.a < 0.999) s += ` stroke-opacity="${n2(c.a)}"`;
  if (line.dash) s += ` stroke-dasharray="${line.dash}"`;
  if (line.cap !== 'butt') s += ` stroke-linecap="${line.cap}"`;
  if (line.join !== 'miter') s += ` stroke-linejoin="${line.join}"`;
  if (line.head) { const id = marker(doc, line.head, css(c), true); if (id) s += ` marker-start="url(#${id})"`; }
  if (line.tail) { const id = marker(doc, line.tail, css(c), false); if (id) s += ` marker-end="url(#${id})"`; }
  return s;
}

// ---------------------------------------------------------------- 阴影

export function shadowFilter(effectLst: XEl | undefined, ctx: ColorContext, doc: SvgDoc): string | undefined {
  const sh = child(effectLst, 'a:outerShdw');
  if (!sh) return undefined;
  const c = colorIn(sh, ctx) ?? { r: 0, g: 0, b: 0, a: 0.4 };
  const blur = (numAttr(sh, 'blurRad') ?? 0) / EMU_PER_PX;
  const dist = (numAttr(sh, 'dist') ?? 0) / EMU_PER_PX;
  const dir = ((numAttr(sh, 'dir') ?? 0) / 60000) * Math.PI / 180;
  const id = doc.id('f');
  doc.addDef(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="${n2(Math.cos(dir) * dist)}" dy="${n2(Math.sin(dir) * dist)}" stdDeviation="${n2(blur / 2)}" flood-color="${css(c)}" flood-opacity="${n2(c.a)}"/></filter>`);
  return id;
}

export { parseColorEl };
