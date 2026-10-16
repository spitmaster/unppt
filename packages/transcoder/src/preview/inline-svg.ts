/**
 * 出图时展开嵌套的 SVG 图片（EMF / WMF 转出来的、原本就是 SVG 的）：resvg 画嵌套的 SVG 图片时不带字体，文字会丢，
 * 所以展开成页面里的普通元素 <g …><svg x y width height viewBox>内容</svg></g>（id 加前缀防冲突；序言、实体、
 * 命名空间见 svg-image.ts）。
 * 同一页里同一张 SVG 图片用到 RASTER_REPEAT 次以上、展开后总量（内容长度 × 次数）超过 RASTER_BYTES 时不逐个展开：实测样本里
 * 有一页把同一张 EMF 用了 256 次，展开后 59MB、resvg 排版 7 万个文字要 98 秒。这种交给 raster 单独画一次成位图
 * （paint.ts，按这一页里最大的显示宽度的 2 倍画），各处贴位图。小图标重复几次照常展开（矢量画最准，位图重采样边缘略有差别）。
 */
import { svgImageParts } from './svg-image';

/** 页面里图片地址（属性原文） -> 原图字节 */
type ImageSource = (href: string) => Promise<Uint8Array | undefined>;

export const RASTER_REPEAT = 3;
export const RASTER_BYTES = 2_000_000;
/** 单独画成位图时的宽度上限（像素） */
const RASTER_MAX = 2048;

/** 把一张完整的 SVG 交给绘制单独画成 width 宽的位图，返回页面里引用它的地址 */
export type RasterHook = (key: string, svg: string, width: number) => string;

export async function inlineSvgImages(svg: string, images: ImageSource, raster?: RasterHook): Promise<string> {
  const tags = [...svg.matchAll(/<image\b[^>]*>/g)].map((m) => m[0]);
  if (!tags.length) return svg;
  const hrefOf = (tag: string) => /\s(?:xlink:)?href="([^"]+)"/.exec(tag)?.[1];
  const uses = new Map<string, number>(), widest = new Map<string, number>();
  for (const t of tags) {
    const h = hrefOf(t);
    if (!h) continue;
    uses.set(h, (uses.get(h) ?? 0) + 1);
    widest.set(h, Math.max(widest.get(h) ?? 0, Number(/\swidth="([\d.]+)"/.exec(t)?.[1]) || 0));
  }
  // 页面的缩放（整页图宽 / viewBox 宽），算位图该画多宽
  const root = /^<svg\b[^>]*>/.exec(svg)?.[0] ?? '';
  const vbw = Number(/\sviewBox="[^"\d-]*-?[\d.]+[\s,]+-?[\d.]+[\s,]+([\d.]+)/.exec(root)?.[1]);
  const scale = vbw > 0 ? (Number(/\swidth="([\d.]+)"/.exec(root)?.[1]) || vbw) / vbw : 1;
  const map = new Map<string, string>();
  const rastered = new Map<string, string>();
  let n = 0;
  for (const tag of tags) {
    if (map.has(tag)) continue;
    const href = hrefOf(tag);
    if (!href) continue;
    let inner: string | undefined;
    if (href.startsWith('data:image/svg+xml;base64,')) inner = decodeBase64(href.slice(26));
    else if (!href.startsWith('data:') && !/\.(png|jpe?g|gif)$/i.test(href)) {
      // 写成文件的 .svg，或者单文件形式里的共享图片编号（unppt:asset/…，没有扩展名）：按内容认 SVG
      const b = await images(href);
      inner = b && isSvg(b) ? new TextDecoder().decode(b) : undefined;
    }
    const parts = inner ? svgImageParts(inner) : undefined;
    if (!parts) continue;
    const count = uses.get(href) ?? 0;
    if (raster && count >= RASTER_REPEAT && inner!.length * count >= RASTER_BYTES) {
      let to = rastered.get(href);
      if (!to) {
        const width = Math.min(RASTER_MAX, Math.max(16, Math.ceil((widest.get(href) ?? 0) * scale * 2)));
        const attrs = parts.attrs.replace(/\sxmlns=("[^"]*"|'[^']*')/, '');
        to = raster(`${href}@${width}`, `<svg xmlns="http://www.w3.org/2000/svg"${attrs}>${parts.body}</svg>`, width);
        rastered.set(href, to);
      }
      map.set(tag, tag.replace(/(\s(?:xlink:)?href=")[^"]+"/, `$1${to}"`));
      continue;
    }
    const attrs = tag.replace(/^<image\b/, '').replace(/\/?>$/, '').replace(/\s(?:xlink:)?href="[^"]*"/, '');
    const get = (k: string) => new RegExp(`\\s${k}="([^"]*)"`).exec(attrs)?.[1];
    const viewBox = /\sviewBox="([^"]*)"/.exec(parts.attrs)?.[1];
    const par = get('preserveAspectRatio') ?? /\spreserveAspectRatio="([^"]*)"/.exec(parts.attrs)?.[1];
    // 其余属性（transform、clip-path、opacity、filter…）放到外面的 g 上
    const rest = attrs.replace(/\s(x|y|width|height|preserveAspectRatio)="[^"]*"/g, '').trim();
    const p = `ni${n++}_`;
    const body = parts.body.replace(/\sid="([^"]+)"/g, ` id="${p}$1"`).replace(/url\(#([^)]+)\)/g, `url(#${p}$1)`).replace(/(\s(?:xlink:)?href=")#([^"]+)"/g, `$1#${p}$2"`);
    const box = ['x', 'y', 'width', 'height'].map((k) => (get(k) !== undefined ? ` ${k}="${get(k)}"` : '')).join('');
    map.set(tag, `<g${rest ? ` ${rest}` : ''}><svg${parts.ns}${box}${viewBox ? ` viewBox="${viewBox}"` : ''}${par ? ` preserveAspectRatio="${par}"` : ''}>${body}</svg></g>`);
  }
  return map.size ? svg.replace(/<image\b[^>]*>/g, (t) => map.get(t) ?? t) : svg;
}

/** 文本开头（跳过 UTF-8 BOM 和空白）是 "<" 的当成 SVG（EMF / WMF 转出来的、原本就是 SVG 的图片） */
function isSvg(b: Uint8Array): boolean {
  let i = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 3 : 0;
  while (i < b.length && (b[i] === 0x20 || b[i] === 0x09 || b[i] === 0x0a || b[i] === 0x0d)) i++;
  return b[i] === 0x3c;
}

function decodeBase64(b64: string): string {
  const s = atob(b64);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return new TextDecoder().decode(b);
}
