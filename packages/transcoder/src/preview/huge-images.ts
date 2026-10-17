/**
 * 超大图片先缩小再交给 resvg（只用于整页图，不改播放器产物）：resvg 会把原图整张解码——样本里有约 3.8 亿像素的 JPEG，
 * 解出来约 1.5GB，用到它的页每页 6~7 秒；WASM 内存只涨不降，上限 4GB，再大一点就画不出来。
 * 超过 HUGE_PIXELS 的 JPEG 按 1/8 解码（每个 8×8 块取平均值，内存是全尺寸的 1/64，渐进式的交流扫描整段跳过）；
 * 长边是整页图长边 4 倍以上的 JPEG 按 1/4、1/8 里最小的、长边仍不小于整页图长边的比例解码（铺满整页也不用放大；
 * 样本里一张 2500 万像素的照片让每个出图线程多占约 600MB，16 个线程峰值 9.9GB → 1.9GB）。1/8 很快（5000 万像素约 0.13 秒），
 * 1/4 要解全部系数（约 1 秒），所以目标不定得更高。
 * 缩好的重新编成 JPEG（质量 95）再交给 resvg；每份转换每张图只做一次。整页图上只在这张图被放大、裁出一小块时会略糊。
 * PNG 照常交给 resvg。
 */
import { imageInfo } from '../media/image-info';
import { decodeJpeg } from '../media/jpeg';
import { jpegEncoder } from '../media/jpeg-encode';

/** 按页面里的图片地址取原图字节 */
type ImageSource = (href: string) => Promise<Uint8Array | undefined>;

/** 像素数超过这个的 JPEG 先缩小（resvg 解码后约 200MB） */
export const HUGE_PIXELS = 50_000_000;
const QUALITY = 95;

/**
 * 要缩小的 JPEG 解码时最长边至少要多大：超过 limit 像素的 1（按 1/8），长边不小于 side 4 倍的 side（side 是整页图的长边，
 * 0 表示不按这条）；不用缩小时 undefined
 */
function shrinkTarget(b: Uint8Array, limit: number, side: number): number | undefined {
  if (b[0] !== 0xff || b[1] !== 0xd8) return undefined;
  const info = imageInfo(b);
  if (!info) return undefined;
  if (info.width * info.height > limit) return 1;
  return side > 0 && Math.max(info.width, info.height) >= side * 4 ? side : undefined;
}

/** 缩小一张超大 JPEG；不是超大 JPEG 或者缩不了时返回 undefined */
export async function shrinkHugeJpeg(b: Uint8Array, limit = HUGE_PIXELS, side = 0): Promise<Uint8Array | undefined> {
  const min = shrinkTarget(b, limit, side);
  if (min === undefined) return undefined;
  const img = decodeJpeg(b, min);
  if (!img || img.width >= (imageInfo(b)?.width ?? 0)) return undefined;
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
export function withHugeImagesShrunk(source: ImageSource, cache: Map<string, Promise<Uint8Array | undefined>>, limit = HUGE_PIXELS, side = 0): ImageSource {
  // 正在读的：多个出图线程同时要同一张图时只读、只缩一次（读完不是超大图的不留，免得把所有图片都存在内存里）
  const reading = new Map<string, Promise<Uint8Array | undefined>>();
  return (href) => {
    const hit = cache.get(href) ?? reading.get(href);
    if (hit) return hit;
    const p = (async () => {
      const b = await source(href);
      if (!b || shrinkTarget(b, limit, side) === undefined) return b;
      const s = shrinkHugeJpeg(b, limit, side).then((x) => x ?? b);
      cache.set(href, s);
      return s;
    })();
    reading.set(href, p);
    void p.finally(() => reading.delete(href)).catch(() => {});
    return p;
  };
}
