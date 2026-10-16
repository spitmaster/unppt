/**
 * TIFF -> PNG：浏览器（除 Safari）不能显示 TIFF，PowerPoint 能。解码交给 utif2（MIT，Photopea 作者的 UTIF.js 的维护版，
 * 支持无压缩、LZW、PackBits、Deflate、JPEG 等压缩方式），取第一幅图转成 8 位 RGBA，再存成 PNG。
 * 多页 TIFF 只取第一页（PowerPoint 也只显示第一页）。
 * 大的不透明照片存成 JPEG（用户 2026-10-16 同意）：样本里有 13.5MP 的照片存成无压缩 TIFF，转 PNG 要 4 秒多、得到 15MB；
 * 存 JPEG（质量 92、不做色度抽样）0.2 秒、几 MB，照片上看不出差别。截图、海报这类带文字的图片存 JPEG 文字边上会起毛，
 * 照旧存 PNG。"照片"按抽样像素判断：和右边相邻像素完全相同的不到一半、颜色不少于 4096 种（样本里 41 张 2MP 以上的
 * TIFF：照片 0.18，界面、网页、海报截图 0.63~0.99）。
 */
import UTIF from 'utif2';
import type { ImageDecoder } from './image-decoder';
import { jpegEncoder } from './jpeg-encode';
import { encodeRgba } from './png';

/** 解码后超过这个像素数的不转（防止异常文件占满内存） */
const MAX_PIXELS = 64 * 1024 * 1024;
/** 不少于这个像素数的照片存 JPEG */
const PHOTO_PIXELS = 2_000_000;
const PHOTO_QUALITY = 92;

export const tiffDecoder: ImageDecoder = {
  exts: ['tif', 'tiff'],
  async decode(bytes) {
    try {
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const ifds = UTIF.decode(buf);
      const ifd = ifds[0];
      if (!ifd) return undefined;
      UTIF.decodeImage(buf, ifd);
      const { width: w, height: h } = ifd;
      if (!w || !h || w * h > MAX_PIXELS) return undefined;
      const rgba = UTIF.toRGBA8(ifd);
      if (w * h >= PHOTO_PIXELS && isPhoto(rgba, w, h)) {
        const jpg = await jpegEncoder().then((encode) => encode(rgba, w, h, PHOTO_QUALITY), () => undefined);
        if (jpg) return { mime: 'image/jpeg', data: jpg };
      }
      const png = await encodeRgba(rgba, w, h);
      return png ? { mime: 'image/png', data: png } : undefined;
    } catch {
      return undefined;
    }
  },
};

/** 不透明，抽样（约 6.5 万个像素）里和右边相邻像素完全相同的不到一半、颜色不少于 4096 种 */
function isPhoto(px: Uint8Array, w: number, h: number): boolean {
  for (let i = 3; i < px.length; i += 4) if (px[i] !== 255) return false;
  const step = Math.max(1, Math.floor((w * h) / 65536));
  const colors = new Set<number>();
  let same = 0, pairs = 0;
  for (let k = 0; k < w * h; k += step) {
    const o = k * 4;
    colors.add((px[o] << 16) | (px[o + 1] << 8) | px[o + 2]);
    if ((k + 1) % w === 0) continue;
    pairs++;
    if (px[o] === px[o + 4] && px[o + 1] === px[o + 5] && px[o + 2] === px[o + 6]) same++;
  }
  return same < pairs / 2 && colors.size >= 4096;
}
