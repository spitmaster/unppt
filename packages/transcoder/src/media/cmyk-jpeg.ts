/**
 * 四分量（Adobe 的 CMYK / YCCK）JPEG 在产物里换成 sRGB 的 JPEG：浏览器各自换算，和 PowerPoint 不一样——Chrome 按嵌入的 ICC 配置文件、
 * 没嵌入时直接取反相乘（颜色偏艳），Firefox 一律直接取反相乘（实测）。按 PowerPoint 的规则（jpeg.ts、icc.ts）换算后所有浏览器一样。
 * 质量 92、不抽样色度（和 TIFF 转出来的照片一样）；很小的图 JPEG 编码器放不下，存 PNG。
 * 超过 1600 万像素的按 1/2 解码（全尺寸解码要的内存太多；播放器显示时远用不到这么大）；超过 5000 万像素的不换
 * （解码器要先存下所有系数，每个分量每像素 2 字节，这么大的图要 400MB 以上），照原样输出，由浏览器自己换算。
 */
import { imageInfo } from './image-info';
import type { DecodedImage } from './image-decoder';
import { decodeJpeg } from './jpeg';
import { jpegEncoder } from './jpeg-encode';
import { encodePixels } from './png';

const FULL_PIXELS = 16_000_000;
const MAX_PIXELS = 50_000_000;
const QUALITY = 92;

/** 是四分量 JPEG 时换成 sRGB；不是、或者解不了时 undefined（调用方照原样输出） */
export async function cmykJpegToSrgb(b: Uint8Array): Promise<DecodedImage | undefined> {
  const info = imageInfo(b);
  if (!info || info.components !== 4 || info.width * info.height > MAX_PIXELS) return undefined;
  const img = decodeJpeg(b, info.width * info.height > FULL_PIXELS ? Math.ceil(Math.max(info.width, info.height) / 2) : undefined);
  if (!img) return undefined;
  const rgba = new Uint8Array(img.width * img.height * 4);
  for (let i = 0, j = 0; i < img.data.length; i += 3, j += 4) {
    rgba[j] = img.data[i]; rgba[j + 1] = img.data[i + 1]; rgba[j + 2] = img.data[i + 2]; rgba[j + 3] = 255;
  }
  const jpg = await jpegEncoder().then((encode) => encode(rgba, img.width, img.height, QUALITY), () => undefined);
  if (jpg) return { mime: 'image/jpeg', data: jpg };
  const png = await encodePixels(img.data, img.width, img.height, 3);
  return png ? { mime: 'image/png', data: png } : undefined;
}
