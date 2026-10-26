/**
 * 读图片文件头里的像素尺寸和分辨率（DPI），不解码图片。支持 PNG、JPEG、GIF、BMP。
 * 纹理平铺要用：PowerPoint 平铺单元的大小 = 像素 × 96 / DPI。
 */

export interface ImageInfo {
  width: number;
  height: number;
  /** 分辨率；文件里没写时为 undefined（PowerPoint 按 96 处理） */
  dpiX?: number;
  dpiY?: number;
  /** JPEG 的颜色分量数（1 灰度、3 YCbCr / RGB、4 CMYK / YCCK） */
  components?: number;
}

const be16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const be32 = (b: Uint8Array, o: number) => (b[o] * 0x1000000) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
const le16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const le32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000;

function png(b: Uint8Array): ImageInfo | undefined {
  if (b.length < 24 || be32(b, 12) !== 0x49484452) return undefined; // IHDR
  const info: ImageInfo = { width: be32(b, 16), height: be32(b, 20) };
  // pHYs：每米多少像素（单位 1 = 米）
  for (let p = 8; p + 12 <= b.length;) {
    const len = be32(b, p), type = be32(b, p + 4);
    if (type === 0x70485973 && len >= 9 && b[p + 16] === 1) {
      info.dpiX = Math.round(be32(b, p + 8) * 0.0254);
      info.dpiY = Math.round(be32(b, p + 12) * 0.0254);
      break;
    }
    if (type === 0x49444154) break; // 图像数据开始，后面不会再有 pHYs
    p += 12 + len;
  }
  return info;
}

function jpeg(b: Uint8Array): ImageInfo | undefined {
  let dpiX: number | undefined, dpiY: number | undefined;
  for (let p = 2; p + 9 < b.length;) {
    if (b[p] !== 0xff) { p++; continue; }
    const m = b[p + 1];
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01 || m === 0xff) { p += m === 0xff ? 1 : 2; continue; }
    const len = be16(b, p + 2);
    // APP0 JFIF：密度单位 1 = 每英寸、2 = 每厘米
    if (m === 0xe0 && b[p + 4] === 0x4a && b[p + 5] === 0x46 && b[p + 6] === 0x49 && b[p + 7] === 0x46) {
      const unit = b[p + 11], x = be16(b, p + 12), y = be16(b, p + 14);
      if (unit === 1) { dpiX = x; dpiY = y; } else if (unit === 2) { dpiX = Math.round(x * 2.54); dpiY = Math.round(y * 2.54); }
    }
    // SOF0~SOF15（不含 DHT=C4、JPG=C8、DAC=CC）
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { width: be16(b, p + 7), height: be16(b, p + 5), dpiX, dpiY, components: b[p + 9] };
    }
    p += 2 + len;
  }
  return undefined;
}

export function imageInfo(b: Uint8Array): ImageInfo | undefined {
  try {
    if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return png(b);
    if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) return jpeg(b);
    if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { width: le16(b, 6), height: le16(b, 8) };
    if (b.length > 46 && b[0] === 0x42 && b[1] === 0x4d) {
      const ppm = le32(b, 38);
      return { width: le32(b, 18), height: Math.abs(le32(b, 22) | 0), ...(ppm ? { dpiX: Math.round(ppm * 0.0254), dpiY: Math.round(le32(b, 42) * 0.0254) } : {}) };
    }
  } catch {
    // 文件头损坏
  }
  return undefined;
}
