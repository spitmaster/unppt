/**
 * 超大图片先缩小再交给 resvg（只用于整页图，不改播放器产物）：resvg 会把原图整张解码——样本里有约 3.8 亿像素的 JPEG，
 * 解出来约 1.5GB，用到它的页每页 6~7 秒；WASM 内存只涨不降，上限 4GB，再大一点就画不出来。
 * 超过 HUGE_PIXELS 的 JPEG 按 1/8 解码（每个 8×8 块取平均值，内存是全尺寸的 1/64，渐进式的交流扫描整段跳过），
 * 重新编成 JPEG（质量 95）再交给 resvg；每份转换每张图只做一次。缩小后最长边仍有原图的 1/8（5000 万像素的图约 1000 像素起），
 * 整页图上只在这张图被放大、裁出一小块时会略糊。PNG 超大的样本里没有（最大不到 5000 万像素），照常交给 resvg。
 */
import { imageInfo } from '../media/image-info';
import { decodeJpeg } from '../media/jpeg';
import { jpegEncoder } from '../media/jpeg-encode';

/** 按页面里的图片地址取原图字节 */
type ImageSource = (href: string) => Promise<Uint8Array | undefined>;

/** 像素数超过这个的 JPEG 先缩小（resvg 解码后约 200MB） */
export const HUGE_PIXELS = 50_000_000;
const QUALITY = 95;

/** 是超过 limit 像素的 JPEG */
function hugeJpeg(b: Uint8Array, limit: number): boolean {
  if (b[0] !== 0xff || b[1] !== 0xd8) return false;
  const info = imageInfo(b);
  return !!info && info.width * info.height > limit;
}

/** 缩小一张超大 JPEG；不是超大 JPEG 或者缩不了时返回 undefined */
export async function shrinkHugeJpeg(b: Uint8Array, limit = HUGE_PIXELS): Promise<Uint8Array | undefined> {
  if (!hugeJpeg(b, limit)) return undefined;
  const img = decodeJpeg(b, 1);
  if (!img) return undefined;
  const rgba = new Uint8Array(img.width * img.height * 4);
  for (let i = 0, j = 0; i < img.data.length; i += 3, j += 4) {
    rgba[j] = img.data[i]; rgba[j + 1] = img.data[i + 1]; rgba[j + 2] = img.data[i + 2]; rgba[j + 3] = 255;
  }
  try {
    return (await jpegEncoder())(rgba, img.width, img.height, QUALITY);
  } catch {
    return undefined;
  }
}

/** 包一层图片来源：超大 JPEG 换成缩小后的版本（cache 跨页共用，每份转换一张图只缩一次） */
export function withHugeImagesShrunk(source: ImageSource, cache: Map<string, Promise<Uint8Array | undefined>>, limit = HUGE_PIXELS): ImageSource {
  return async (href) => {
    const hit = cache.get(href);
    if (hit) return hit;
    const b = await source(href);
    if (!b || !hugeJpeg(b, limit)) return b;
    const p = shrinkHugeJpeg(b, limit).then((s) => s ?? b);
    cache.set(href, p);
    return p;
  };
}
