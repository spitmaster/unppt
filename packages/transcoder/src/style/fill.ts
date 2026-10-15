/**
 * 填充（纯色、渐变、图片、图案）-> SVG 属性和 defs；主题样式引用（fillRef / lnRef / effectRef）。
 */
import { colorIn, css, type ColorContext, type Rgba } from '../model/color';
import type { SvgDoc } from '../common/svg';
import { esc, n2 } from '../common/svg';
import { attr, child, children, findAll, numAttr, type XEl } from '../io/xml';
import { EMU_PER_PX, type Theme } from '../model/model';
import { blipFilter, parseBlipEffects, type BlipEffects } from './blip';
import { patternFill } from './pattern';
import { gradientStops } from './gradient-stops';

/** 平铺（a:tile）：缩放比例、偏移（像素）、对齐方式、翻转 */
export interface Tile { sx: number; sy: number; tx: number; ty: number; algn: string; flip: string }

export type Fill =
  | { kind: 'none' }
  | { kind: 'solid'; color: Rgba }
  | { kind: 'grad'; stops: { pos: number; color: Rgba }[]; angle: number; scaled?: boolean; path?: string; rect?: { l: number; t: number; r: number; b: number } }
  | { kind: 'image'; rid: string; part: string; alpha: number; tile?: Tile; srcRect?: { l: number; t: number; r: number; b: number }; fillRect?: { l: number; t: number; r: number; b: number }; effects?: BlipEffects }
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
        ...(attr(lin, 'scaled') === '1' || attr(lin, 'scaled') === 'true' ? { scaled: true } : {}),
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
      const fr = child(child(f, 'a:stretch'), 'a:fillRect');
      return {
        kind: 'image', rid, part, alpha: (numAttr(amf, 'amt') ?? 100000) / 100000, tile: parseTile(child(f, 'a:tile')),
        effects: parseBlipEffects(blip, ctx),
        srcRect: sr ? {
          l: (numAttr(sr, 'l') ?? 0) / 100000, t: (numAttr(sr, 't') ?? 0) / 100000,
          r: (numAttr(sr, 'r') ?? 0) / 100000, b: (numAttr(sr, 'b') ?? 0) / 100000,
        } : undefined,
        // 拉伸的目标矩形：相对形状框的内边距（负数是伸出形状，伸出的部分被形状裁掉）
        fillRect: fr && (fr.attrs.l || fr.attrs.t || fr.attrs.r || fr.attrs.b) ? {
          l: (numAttr(fr, 'l') ?? 0) / 100000, t: (numAttr(fr, 't') ?? 0) / 100000,
          r: (numAttr(fr, 'r') ?? 0) / 100000, b: (numAttr(fr, 'b') ?? 0) / 100000,
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
  /** 图片的像素尺寸和分辨率（平铺用）；读不到时返回 undefined */
  info?(part: string, rid: string): Promise<{ width: number; height: number; dpiX?: number; dpiY?: number } | undefined>;
  /** 在原图上把 key 颜色抠成透明后的 href；这张图做不了时返回 undefined */
  keyed?(part: string, rid: string, key: Rgba): Promise<string | undefined>;
}

/**
 * 图片的 href 和要套的调整滤镜。"设置透明色"能在原图上做时（PNG）直接用抠好的图，滤镜里不再做透明色；
 * 做不了的用滤镜近似（见 blip.ts）
 */
export async function blipImage(images: ImageResolver, part: string, rid: string, effects: BlipEffects | undefined, doc: SvgDoc): Promise<{ href?: string; filter?: string }> {
  const key = effects?.clrChange;
  const keyed = key ? await images.keyed?.(part, rid, key) : undefined;
  const href = keyed ?? await images.image(part, rid);
  return { href, filter: blipFilter(keyed ? { ...effects, clrChange: undefined } : effects, doc) };
}

function parseTile(t: XEl | undefined): Tile | undefined {
  if (!t) return undefined;
  return {
    sx: (numAttr(t, 'sx') ?? 100000) / 100000, sy: (numAttr(t, 'sy') ?? 100000) / 100000,
    tx: (numAttr(t, 'tx') ?? 0) / EMU_PER_PX, ty: (numAttr(t, 'ty') ?? 0) / EMU_PER_PX,
    algn: attr(t, 'algn') ?? 'tl', flip: attr(t, 'flip') ?? 'none',
  };
}

/**
 * 平铺的图片填充。实测：平铺单元 = 图片像素 × 96 / DPI（没写 DPI 按 96）× 缩放比例，
 * 按对齐方式定位后再加偏移；翻转时用两倍大的单元拼出镜像。
 */
async function tileFill(fill: Extract<Fill, { kind: 'image' }>, tile: Tile, href: string, fid: string | undefined, doc: SvgDoc, w: number, h: number, images: ImageResolver): Promise<string | undefined> {
  const info = await images.info?.(fill.part, fill.rid);
  if (!info || !info.width || !info.height) return undefined;
  const tw = info.width * 96 / (info.dpiX || 96) * tile.sx, th = info.height * 96 / (info.dpiY || 96) * tile.sy;
  if (!(tw > 0.5 && th > 0.5)) return undefined;
  const fx = /r$/.test(tile.algn) ? 1 : /^(t|b|ctr)$/.test(tile.algn) ? 0.5 : 0;
  const fy = /^b/.test(tile.algn) ? 1 : /^(l|r|ctr)$/.test(tile.algn) ? 0.5 : 0;
  const mx = tile.flip === 'x' || tile.flip === 'xy', my = tile.flip === 'y' || tile.flip === 'xy';
  const pw = tw * (mx ? 2 : 1), ph = th * (my ? 2 : 1);
  const img = (tr: string) => `<image href="${esc(href)}" width="${n2(tw)}" height="${n2(th)}" preserveAspectRatio="none"${tr}${fill.alpha < 1 ? ` opacity="${n2(fill.alpha)}"` : ''}${fid ? ` filter="url(#${fid})"` : ''}/>`;
  let tiles = img('');
  if (mx) tiles += img(` transform="translate(${n2(2 * tw)} 0) scale(-1 1)"`);
  if (my) tiles += img(` transform="translate(0 ${n2(2 * th)}) scale(1 -1)"`);
  if (mx && my) tiles += img(` transform="translate(${n2(2 * tw)} ${n2(2 * th)}) scale(-1 -1)"`);
  const id = doc.id('p');
  doc.addDef(`<pattern id="${id}" patternUnits="userSpaceOnUse" x="${n2((w - tw) * fx + tile.tx)}" y="${n2((h - th) * fy + tile.ty)}" width="${n2(pw)}" height="${n2(ph)}">${tiles}</pattern>`);
  return ` fill="url(#${id})"`;
}

/** 渐变：生成 defs 里的渐变定义，返回 url(#编号)（填充和描边共用）。w/h 是形状尺寸 */
export function gradientPaint(fill: Extract<Fill, { kind: 'grad' }>, doc: SvgDoc, w: number, h: number, mode: string): string {
  const id = doc.id('g');
  const stops = gradientStops(fill.stops, (c) => adjustForPathMode(c, mode));
  if (fill.path === 'rect' || fill.path === 'shape') return rectGradient(fill, doc, w, h, stops);
  if (fill.path) {
    // 实测（6 种焦点 × 正方形和 2:1 矩形，吻合到抖动噪声水平）：渐变的终点是形状的外接圆
    // （圆心在形状中心、半径是半条对角线），起点是焦点矩形的中心——正好是 SVG 径向渐变的焦点（fx/fy）
    const r = fill.rect ?? { l: 0.5, t: 0.5, r: 0.5, b: 0.5 };
    // 焦点矩形是四边的内缩比例；左右（上下）内缩加起来超过 100% 时矩形倒置，收拢到左（上）边
    let fx = (r.l + Math.max(r.l, 1 - r.r)) / 2 * w;
    let fy = (r.t + Math.max(r.t, 1 - r.b)) / 2 * h;
    const cx = w / 2, cy = h / 2, rad = Math.hypot(w, h) / 2;
    // 焦点在角上时正好落在圆上，往圆心挪一点点，避免渐变退化
    fx = cx + (fx - cx) * 0.995; fy = cy + (fy - cy) * 0.995;
    doc.addDef(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${n2(cx)}" cy="${n2(cy)}" r="${n2(rad)}" fx="${n2(fx)}" fy="${n2(fy)}">${stops}</radialGradient>`);
  } else {
    const a = fill.angle * Math.PI / 180;
    let dx = Math.cos(a), dy = Math.sin(a);
    // scaled：角度在单位正方形里定义，随形状长宽比拉伸
    if (fill.scaled && w > 0 && h > 0) {
      const sx = dx / w, sy = dy / h, len = Math.hypot(sx, sy) || 1;
      dx = sx / len; dy = sy / len;
    }
    const cx = w / 2, cy = h / 2;
    // 让四个角在渐变方向上的投影刚好落在 0..1
    const proj = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => (x - cx) * dx + (y - cy) * dy);
    const lo = Math.min(...proj), hi = Math.max(...proj);
    doc.addDef(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n2(cx + dx * lo)}" y1="${n2(cy + dy * lo)}" x2="${n2(cx + dx * hi)}" y2="${n2(cy + dy * hi)}">${stops}</linearGradient>`);
  }
  return `url(#${id})`;
}

/**
 * 矩形（path=rect）渐变：实测 t = max(水平距离, 垂直距离)，距离从焦点矩形量起、按那一侧到边框的距离归一化，
 * 等值线是从焦点矩形放大到外框的一圈圈矩形。SVG 没有这种渐变：用图案拼出上下左右四个梯形，各自是线性渐变
 * （梯形之间的分界是焦点矩形角到外框角的连线）；"形状"路径（path=shape）也按矩形画。
 */
function rectGradient(fill: Extract<Fill, { kind: 'grad' }>, doc: SvgDoc, w: number, h: number, stops: string): string {
  const r = fill.rect ?? { l: 0.5, t: 0.5, r: 0.5, b: 0.5 };
  const x0 = r.l * w, x1 = Math.max(r.l, 1 - r.r) * w, y0 = r.t * h, y1 = Math.max(r.t, 1 - r.b) * h;
  const pid = doc.id('rg');
  const parts: string[] = [];
  const P = (pts: number[][]) => pts.map(([x, y]) => `${n2(x)},${n2(y)}`).join(' ');
  // 一个梯形：渐变从 (ax, ay)（焦点矩形边）到 (bx, by)（外框）
  const side = (pts: number[][], ax: number, ay: number, bx: number, by: number) => {
    if (Math.hypot(bx - ax, by - ay) < 0.01) return;
    const gid = doc.id('g');
    doc.addDef(`<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${n2(ax)}" y1="${n2(ay)}" x2="${n2(bx)}" y2="${n2(by)}">${stops}</linearGradient>`);
    parts.push(`<polygon points="${P(pts)}" fill="url(#${gid})"/>`);
  };
  side([[0, 0], [x0, y0], [x0, y1], [0, h]], x0, 0, 0, 0);
  side([[w, 0], [x1, y0], [x1, y1], [w, h]], x1, 0, w, 0);
  side([[0, 0], [w, 0], [x1, y0], [x0, y0]], 0, y0, 0, 0);
  side([[0, h], [w, h], [x1, y1], [x0, y1]], 0, y1, 0, h);
  // 焦点矩形里面是起点颜色
  const first = /stop-color="([^"]+)"(?: stop-opacity="([^"]+)")?/.exec(stops);
  if (first && x1 > x0 && y1 > y0) parts.push(`<rect x="${n2(x0)}" y="${n2(y0)}" width="${n2(x1 - x0)}" height="${n2(y1 - y0)}" fill="${first[1]}"${first[2] ? ` fill-opacity="${first[2]}"` : ''}/>`);
  // 不抗锯齿：相邻梯形在分界处颜色相同，抗锯齿反而会露出缝
  doc.addDef(`<pattern id="${pid}" patternUnits="userSpaceOnUse" width="${n2(w)}" height="${n2(h)}"><g shape-rendering="crispEdges">${parts.join('')}</g></pattern>`);
  return `url(#${pid})`;
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
  if (fill.kind === 'grad') return ` fill="${gradientPaint(fill, doc, w, h, mode)}"`;
  // 图片填充：用 pattern 把图片拉伸到形状框
  const { href, filter: fid } = await blipImage(images, fill.part, fill.rid, fill.effects, doc);
  if (!href) return ' fill="#d9d9d9"';
  if (fill.tile) {
    const tiled = await tileFill(fill, fill.tile, href, fid, doc, w, h, images);
    if (tiled) return tiled;
  }
  const id = doc.id('p');
  const { x, y, iw, ih } = imagePlacement(fill, w, h);
  doc.addDef(`<pattern id="${id}" patternUnits="userSpaceOnUse" width="${n2(w)}" height="${n2(h)}"><image href="${esc(href)}" x="${n2(x)}" y="${n2(y)}" width="${n2(iw)}" height="${n2(ih)}" preserveAspectRatio="none"${fill.alpha < 1 ? ` opacity="${n2(fill.alpha)}"` : ''}${fid ? ` filter="url(#${fid})"` : ''}/></pattern>`);
  return ` fill="url(#${id})"`;
}

/**
 * 拉伸的图片放在形状框（w × h）里的位置和大小：先按 fillRect 的内边距得到目标矩形（实测 picture-fill-rect），
 * 再按 srcRect 的裁剪把原图放大，使裁剪后的部分正好铺满目标矩形
 */
export function imagePlacement(fill: { srcRect?: { l: number; t: number; r: number; b: number }; fillRect?: { l: number; t: number; r: number; b: number } }, w: number, h: number) {
  const sr = fill.srcRect ?? { l: 0, t: 0, r: 0, b: 0 };
  const fr = fill.fillRect ?? { l: 0, t: 0, r: 0, b: 0 };
  const tw = w * (1 - fr.l - fr.r), th = h * (1 - fr.t - fr.b);
  const iw = tw / Math.max(0.0001, 1 - sr.l - sr.r), ih = th / Math.max(0.0001, 1 - sr.t - sr.b);
  return { x: fr.l * w - sr.l * iw, y: fr.t * h - sr.t * ih, iw, ih };
}
