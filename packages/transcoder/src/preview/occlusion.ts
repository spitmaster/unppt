/**
 * 出图前的遮挡剔除（只用于整页图，不改播放器产物）：页面根层级上，被后面一张不透明、铺满整页的图片完全盖住的元素不画。
 * 母版、版式的背景图常常一层叠一层，盖在下面的那些每页都要解码、缩放一遍，是出图最贵的部分之一。
 * 只认转码器自己写出的最简单的结构——只有平移的嵌套 <g> 里包一张 <image>（没有透明度、滤镜、裁剪、变换）——其它写法一律照旧画，
 * 画出来的和不剔除的几乎逐像素相同：resvg 缩放图片时个别像素的不透明度不是精确的 255，底下的颜色会透出 1/255——
 * 4 份样本 322 页里只有 1 页 1 个像素差 1，其余逐字节一致。
 */

import { rootChildren } from './svg-root';

/** 按页面里的图片地址取原图字节 */
type ImageSource = (href: string) => Promise<Uint8Array | undefined>;

const NUM = '(-?\\d+(?:\\.\\d+)?(?:e-?\\d+)?)';
/** 只有平移（或没有变换）、只带 data-* 标记的 <g> */
const GROUP = new RegExp(`^<g((?:\\s+data-[\\w-]+="[^"]*")*)(?:\\s+transform="translate\\(${NUM}(?:[ ,]+${NUM})?\\)")?((?:\\s+data-[\\w-]+="[^"]*")*)\\s*>`);
/** 只有位置、大小、地址、preserveAspectRatio="none" 的 <image/> */
const IMAGE = /^<image((?:\s+(?:href|xlink:href|x|y|width|height|preserveAspectRatio)="[^"]*")+)\s*\/>/;

/** 这个根元素如果是"平移的 g 里包一张图片"，返回图片的外框（页面坐标）和地址 */
function plainImage(kid: string): { x: number; y: number; w: number; h: number; href: string } | undefined {
  let tx = 0, ty = 0, rest = kid, depth = 0;
  for (let m = GROUP.exec(rest); m; m = GROUP.exec(rest)) {
    tx += m[2] !== undefined ? +m[2] : 0;
    ty += m[3] !== undefined ? +m[3] : 0;
    rest = rest.slice(m[0].length);
    depth++;
  }
  const img = IMAGE.exec(rest);
  if (!img || rest.slice(img[0].length) !== '</g>'.repeat(depth)) return undefined;
  const get = (k: string) => new RegExp(`\\s${k}="([^"]*)"`).exec(img[1])?.[1];
  const href = get('href') ?? get('xlink:href');
  if (!href || get('preserveAspectRatio') !== 'none') return undefined;
  const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((k) => Number(get(k) ?? 0));
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return undefined;
  return { x: x + tx, y: y + ty, w, h, href };
}

/** 图片字节一定完全不透明：JPEG；或者灰度、RGB、调色板 PNG 且没有 tRNS（透明色）块 */
export function opaqueImage(b: Uint8Array | undefined): boolean {
  if (!b || b.length < 33) return false;
  if (b[0] === 0xff && b[1] === 0xd8) return true;
  if (b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) return false;
  const colorType = b[25];
  if (colorType !== 0 && colorType !== 2 && colorType !== 3) return false;
  for (let i = 8; i + 8 <= b.length;) {
    const len = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    if (type === 'tRNS') return false;
    if (type === 'IDAT') return true;
    i += 12 + len;
  }
  return false;
}

function dataUriBytes(href: string): Uint8Array | undefined {
  const m = /^data:image\/(?:png|jpeg|jpg);base64,(.*)$/s.exec(href);
  if (!m) return undefined;
  try {
    const s = atob(m[1]);
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  } catch {
    return undefined;
  }
}

/** 剔除被整页不透明图片盖住的根元素；没有可剔除的时原样返回 */
export async function cullOccluded(svg: string, images: ImageSource): Promise<string> {
  const vb = /^<svg\b[^>]*\sviewBox="\s*0[ ,]+0[ ,]+([\d.]+)[ ,]+([\d.]+)\s*"/.exec(svg);
  if (!vb) return svg;
  const W = +vb[1], H = +vb[2];
  const root = rootChildren(svg);
  if (!root) return svg;
  const { kids } = root;
  // 从后往前找最后一张盖满整页的不透明图片
  let cut = -1;
  for (let i = kids.length - 1; i > 0 && cut < 0; i--) {
    const img = plainImage(kids[i]);
    if (!img || img.x > 0 || img.y > 0 || img.x + img.w < W || img.y + img.h < H) continue;
    const bytes = img.href.startsWith('data:') ? dataUriBytes(img.href) : await images(img.href);
    if (opaqueImage(bytes)) cut = i;
  }
  if (cut <= 0) return svg;
  // defs、style 不管在哪都保留（style 没有 id，但会影响后面的元素）
  const always = (k: string) => /^<(?:defs|style)\b/.test(k);
  const dropped = kids.slice(0, cut).filter((k) => !always(k));
  if (!dropped.length) return svg;
  const kept = kids.filter((k, i) => i >= cut || always(k)).join('');
  // 被剔除部分里定义的东西如果还有人引用（渐变、裁剪路径……），就不剔除
  for (const k of dropped) for (const [, id] of k.matchAll(/\sid="([^"]+)"/g)) if (kept.includes(`#${id}`)) return svg;
  return root.open + kept + root.close;
}
