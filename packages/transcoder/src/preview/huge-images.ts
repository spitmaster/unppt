/**
 * 超大图片先缩小再交给 resvg（只用于整页图，不改播放器产物）：resvg 会把原图整张解码，WASM 内存只涨不降（上限 4GB）——
 * 样本里有约 3.8 亿像素的 JPEG，解出来约 1.5GB，用到它的页每页 6~7 秒；一张 2500 万像素的照片就让每个出图线程多占约 600MB，
 * 16 个线程峰值 9.9GB（缩小后 1.3GB）。
 *   - 超过 HUGE_PIXELS 的 JPEG 按 1/8 解码（每个 8×8 块取平均值，内存是全尺寸的 1/64，渐进式的交流扫描整段跳过）；
 *   - 长边是整页图长边 4 倍以上的 JPEG 按 1/4、1/8 里最小的、长边仍不小于整页图长边的比例解码（铺满整页也不用放大）。
 *     1/8 很快（5000 万像素约 0.13 秒），1/4 要解全部系数（约 1 秒），所以目标不定得更高；
 *   - 长边是整页图长边 4 倍以上的 PNG 按整数倍缩到长边不小于整页图（media/png-shrink.ts，边解压边缩，不展开整张原图）。
 * 缩好的 JPEG 重新编成 JPEG（质量 95），PNG 还是 PNG；每份转换每张图只做一次。整页图上只在这张图被放大、裁出一小块时会略糊。
 * 四分量（Adobe 的 CMYK / YCCK）JPEG 不管大小都在这里按 PowerPoint 的规则（media/jpeg.ts）换成 RGB 的 JPEG：resvg 整张不画（实测），
 * 不用缩的按全尺寸解。播放器用的是转码时换好的图（media/cmyk-jpeg.ts），出图读到的是原图。
 */
import { imageInfo } from '../media/image-info';
import { decodeJpeg } from '../media/jpeg';
import { jpegEncoder } from '../media/jpeg-encode';
import { encodePixels } from '../media/png';
import { shrinkPng } from '../media/png-shrink';

/** 按页面里的图片地址取原图字节 */
type ImageSource = (href: string) => Promise<Uint8Array | undefined>;

/** 像素数超过这个的 JPEG 先缩小（resvg 解码后约 200MB） */
export const HUGE_PIXELS = 50_000_000;
const QUALITY = 95;

/**
 * 怎么缩：JPEG 给解码时最长边至少要多大（decodeJpeg 的 minSize，undefined 是全尺寸），cmyk 是四分量的（不缩也要换成 RGB）；
 * PNG 给缩小倍数
 */
type Plan = { jpeg: number | undefined; cmyk: boolean } | { png: number };

/** side 是整页图的长边（0 表示不按长边缩）；不用处理时 undefined */
function planFor(b: Uint8Array, limit: number, side: number): Plan | undefined {
  const jpeg = b[0] === 0xff && b[1] === 0xd8, png = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  if (!jpeg && !png) return undefined;
  const info = imageInfo(b);
  if (!info) return undefined;
  const long = Math.max(info.width, info.height);
  const bySide = side > 0 && long >= side * 4;
  if (jpeg) {
    const cmyk = info.components === 4;
    const min = info.width * info.height > limit ? 1 : bySide ? side : undefined;
    return min !== undefined || cmyk ? { jpeg: min, cmyk } : undefined;
  }
  return bySide ? { png: Math.floor(long / side) } : undefined;
}

/** 缩小一张超大图片（四分量 JPEG 换成 RGB）；不用缩或者缩不了时返回 undefined */
export async function shrinkHugeImage(b: Uint8Array, limit = HUGE_PIXELS, side = 0): Promise<Uint8Array | undefined> {
  const plan = planFor(b, limit, side);
  if (!plan) return undefined;
  if ('png' in plan) return shrinkPng(b, plan.png).catch(() => undefined);
  const img = decodeJpeg(b, plan.jpeg);
  if (!img || (!plan.cmyk && img.width >= (imageInfo(b)?.width ?? 0))) return undefined;
  const rgba = new Uint8Array(img.width * img.height * 4);
  for (let i = 0, j = 0; i < img.data.length; i += 3, j += 4) {
    rgba[j] = img.data[i]; rgba[j + 1] = img.data[i + 1]; rgba[j + 2] = img.data[i + 2]; rgba[j + 3] = 255;
  }
  try {
    // 很小的图 JPEG 编码器放不下（见 jpeg-encode.ts），编成 PNG
    return (await jpegEncoder())(rgba, img.width, img.height, QUALITY) ?? await encodePixels(img.data, img.width, img.height, 3);
  } catch {
    return undefined;
  }
}

/** 包一层图片来源：超大图片换成缩小后的版本（cache 跨页共用，每份转换一张图只缩一次） */
export function withHugeImagesShrunk(source: ImageSource, cache: Map<string, Promise<Uint8Array | undefined>>, limit = HUGE_PIXELS, side = 0): ImageSource {
  // 正在读的：多个出图线程同时要同一张图时只读、只缩一次（读完不是超大图的不留，免得把所有图片都存在内存里）
  const reading = new Map<string, Promise<Uint8Array | undefined>>();
  return (href) => {
    const hit = cache.get(href) ?? reading.get(href);
    if (hit) return hit;
    const p = (async () => {
      const b = await source(href);
      if (!b || !planFor(b, limit, side)) return b;
      const s = shrinkHugeImage(b, limit, side).then((x) => x ?? b);
      cache.set(href, s);
      return s;
    })();
    reading.set(href, p);
    void p.finally(() => reading.delete(href)).catch(() => {});
    return p;
  };
}
