/**
 * TIFF -> PNG：浏览器（除 Safari）不能显示 TIFF，PowerPoint 能。解码交给 utif2（MIT，Photopea 作者的 UTIF.js 的维护版，
 * 支持无压缩、LZW、PackBits、Deflate、JPEG 等压缩方式），取第一幅图转成 8 位 RGBA，再存成 PNG。
 * 多页 TIFF 只取第一页（PowerPoint 也只显示第一页）。
 */
import UTIF from 'utif2';
import type { ImageDecoder } from './image-decoder';
import { encodeRgba } from './png';

/** 解码后超过这个像素数的不转（防止异常文件占满内存） */
const MAX_PIXELS = 64 * 1024 * 1024;

export const tiffDecoder: ImageDecoder = {
  exts: ['tif', 'tiff'],
  async decode(bytes) {
    try {
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const ifds = UTIF.decode(buf);
      const ifd = ifds[0];
      if (!ifd) return undefined;
      UTIF.decodeImage(buf, ifd);
      if (!ifd.width || !ifd.height || ifd.width * ifd.height > MAX_PIXELS) return undefined;
      const png = await encodeRgba(UTIF.toRGBA8(ifd), ifd.width, ifd.height);
      return png ? { mime: 'image/png', data: png } : undefined;
    } catch {
      return undefined;
    }
  },
};
