/**
 * 图片"设置透明色"（a:clrChange）在原图上抠，抠完是 PNG。PowerPoint 先在原图上抠再缩放（缩小后边缘没有亮边）；
 * 阈值按格式不同（实测）：PNG 每个通道和目标色差 ≤ 1 才透明，JPEG ≤ 16（JPEG 的噪点一起抠掉）。
 * 不是 PNG / JPEG、或者解不开的返回 undefined，调用方退回滤镜近似。
 */
import type { Rgba } from '../model/color';
import { decodeJpeg } from './jpeg';
import { encodeRgba } from './png';
import { pngColorKey } from './png-key';

const JPEG_TOLERANCE = 16;

export async function colorKey(bytes: Uint8Array, key: Rgba): Promise<Uint8Array | undefined> {
  if (bytes[0] === 0x89) return pngColorKey(bytes, key);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  const img = decodeJpeg(bytes);
  if (!img) return undefined;
  const { width, height, data } = img;
  const px = new Uint8Array(width * height * 4);
  const T = JPEG_TOLERANCE;
  for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    px[j] = r;
    px[j + 1] = g;
    px[j + 2] = b;
    px[j + 3] = Math.abs(r - key.r) <= T && Math.abs(g - key.g) <= T && Math.abs(b - key.b) <= T ? 0 : 255;
  }
  return encodeRgba(px, width, height);
}
