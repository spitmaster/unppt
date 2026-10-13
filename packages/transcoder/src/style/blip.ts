/**
 * 图片调整（a:blip 里的双色调、灰度、亮度对比度、设置透明色）-> SVG filter。
 */
import { colorIn, parseColorEl, type ColorContext, type Rgba } from '../model/color';
import type { SvgDoc } from '../common/svg';
import { child, numAttr, type XEl } from '../io/xml';

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

/**
 * 透明色的容差：三个通道与目标色的差之和达到 255/CLR_CHANGE_GAIN 时完全不透明。
 * 实测 PowerPoint 是硬阈值（每个通道差不超过 1 才透明），但它在原图像素上抠完再缩放。
 * PNG、JPEG 已经在原图上抠（media/color-key.ts，见 fill.ts 的 blipImage）；这里只给做不了的图片（GIF、BMP、解不开的）近似：
 * SVG 滤镜作用在缩放后的像素上，边缘混进了白色，硬阈值会留一圈亮边，所以用渐变近似。
 */
const CLR_CHANGE_GAIN = 4;

/** 图片调整 -> SVG filter，返回 filter id */
export function blipFilter(e: BlipEffects | undefined, doc: SvgDoc): string | undefined {
  if (!e) return undefined;
  const parts: string[] = [];
  if (e.clrChange) {
    // 某种颜色变透明：逐通道算 |像素 - 目标色|（正负各算一次再相加），三个通道的差加起来乘一个倍数当作透明度，
    // 差越小越透明（JPEG 有噪点，所以留一点容差）
    const { r, g, b } = e.clrChange;
    parts.push(`<feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 -${f01(r)} 0 1 0 0 -${f01(g)} 0 0 1 0 -${f01(b)} 0 0 0 1 0" result="d1"/>`);
    parts.push(`<feColorMatrix in="SourceGraphic" type="matrix" values="-1 0 0 0 ${f01(r)} 0 -1 0 0 ${f01(g)} 0 0 -1 0 ${f01(b)} 0 0 0 1 0" result="d2"/>`);
    parts.push('<feComposite in="d1" in2="d2" operator="arithmetic" k2="1" k3="1" result="d"/>');
    parts.push(`<feColorMatrix in="d" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${CLR_CHANGE_GAIN} ${CLR_CHANGE_GAIN} ${CLR_CHANGE_GAIN} 0 0" result="m"/>`);
    parts.push('<feComposite in="SourceGraphic" in2="m" operator="in"/>');
  }
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
