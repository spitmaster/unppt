/**
 * BMP 转 PNG（出图用：resvg 不认 BMP，页面里的 .bmp 图片、EMF / WMF 里的位图（转成了 BMP 的 data URI）整页图上都会缺）。
 * 支持 OS/2 和 Windows 的各种文件头；1/4/8 位调色板（含 RLE8、RLE4 压缩）、16 位（555 或位域）、24 位、32 位；
 * 32 位不带位域（BI_RGB）时第四个字节不当透明度（GDI 也忽略它），位域格式里写了透明度掩码才用透明度。
 * 里面直接存 JPEG / PNG 的（BI_JPEG、BI_PNG）原样取出来。没有透明度的出 RGB 的 PNG。
 */
import { encodePixels } from './png';

/** 像素数超过这个的不解（防止异常文件占满内存） */
const MAX_PIXELS = 64_000_000;

export function isBmp(b: Uint8Array): boolean {
  return b.length > 26 && b[0] === 0x42 && b[1] === 0x4d;
}

/** BMP -> PNG（或者里面存的 JPEG / PNG）；格式不支持或数据有问题时返回 undefined */
export async function bmpToPng(b: Uint8Array): Promise<Uint8Array | undefined> {
  const img = decodeBmp(b);
  if (!img) return undefined;
  if ('embedded' in img) return img.embedded;
  if (img.alpha) return encodePixels(img.data, img.width, img.height, 4);
  const rgb = new Uint8Array(img.width * img.height * 3);
  for (let i = 0, j = 0; j < rgb.length; i += 4, j += 3) { rgb[j] = img.data[i]; rgb[j + 1] = img.data[i + 1]; rgb[j + 2] = img.data[i + 2]; }
  return encodePixels(rgb, img.width, img.height, 3);
}

type Decoded = { width: number; height: number; data: Uint8Array; alpha: boolean } | { embedded: Uint8Array };

/** RGBA 像素（从上往下）编成 32 位、带透明度掩码的 BMP（BITMAPV4HEADER：浏览器和 decodeBmp 都认透明度） */
export function rgbaToBmp(w: number, h: number, rgba: Uint8Array): Uint8Array {
  const n = w * h * 4;
  const out = new Uint8Array(14 + 108 + n);
  const v = new DataView(out.buffer);
  out[0] = 0x42; out[1] = 0x4d;
  v.setUint32(2, out.length, true); v.setUint32(10, 14 + 108, true);
  v.setUint32(14, 108, true); v.setInt32(18, w, true); v.setInt32(22, -h, true);
  v.setUint16(26, 1, true); v.setUint16(28, 32, true); v.setUint32(30, 3, true); v.setUint32(34, n, true);   // BI_BITFIELDS
  v.setUint32(54, 0x00ff0000, true); v.setUint32(58, 0x0000ff00, true); v.setUint32(62, 0x000000ff, true); v.setUint32(66, 0xff000000, true);
  v.setUint32(70, 0x73524742, true);                                                                       // 'sRGB'
  for (let i = 0, o = 122; i < n; i += 4, o += 4) { out[o] = rgba[i + 2]; out[o + 1] = rgba[i + 1]; out[o + 2] = rgba[i]; out[o + 3] = rgba[i + 3]; }
  return out;
}

/** BMP 里颜色正好是 key（0xRRGGBB）的像素变透明，返回新的 BMP；解不开时返回 undefined */
export function keyBmp(b: Uint8Array, key: number): Uint8Array | undefined {
  const img = decodeBmp(b);
  if (!img || 'embedded' in img) return undefined;
  const r = (key >> 16) & 255, g = (key >> 8) & 255, bl = key & 255, px = img.data;
  for (let i = 0; i < px.length; i += 4) if (px[i] === r && px[i + 1] === g && px[i + 2] === bl) px[i + 3] = 0;
  return rgbaToBmp(img.width, img.height, px);
}

/** 按位域掩码取一个通道并换算到 0~255；掩码是 0 时返回 undefined */
function field(mask: number): ((v: number) => number) | undefined {
  if (!mask) return undefined;
  let shift = 0;
  while (!((mask >>> shift) & 1)) shift++;
  const max = mask >>> shift;
  return (v) => Math.round((((v & mask) >>> shift) * 255) / max);
}

export function decodeBmp(b: Uint8Array): Decoded | undefined {
  if (!isBmp(b)) return undefined;
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const offBits = d.getUint32(10, true), hs = d.getUint32(14, true);
  let w: number, h: number, bpp: number, comp = 0, colors = 0, palEntry = 4;
  if (hs === 12) {
    w = d.getUint16(18, true); h = d.getInt16(20, true); bpp = d.getUint16(24, true); palEntry = 3;
  } else if (hs >= 40 && 14 + hs <= b.length) {
    w = d.getInt32(18, true); h = d.getInt32(22, true); bpp = d.getUint16(28, true); comp = d.getUint32(30, true); colors = d.getUint32(46, true);
  } else return undefined;
  if (comp === 4 || comp === 5) return offBits < b.length ? { embedded: b.subarray(offBits) } : undefined;
  const topDown = h < 0;
  h = Math.abs(h);
  if (w <= 0 || !h || w * h > MAX_PIXELS || offBits >= b.length) return undefined;
  // 位域掩码：V3 以上的文件头里有；40 字节的文件头时跟在后面（BI_BITFIELDS 3 个，BI_ALPHABITFIELDS 4 个）
  let masks: number[] | undefined;
  if (comp === 3 || comp === 6) {
    const at = hs >= 52 ? 54 : 14 + hs, n = comp === 6 || hs >= 56 ? 4 : 3;
    if (at + n * 4 > b.length) return undefined;
    masks = Array.from({ length: n }, (_, i) => d.getUint32(at + i * 4, true));
  } else if (bpp === 16) masks = [0x7c00, 0x03e0, 0x001f];
  else if (comp !== 0 && comp !== 1 && comp !== 2) return undefined;
  if (![1, 4, 8, 16, 24, 32].includes(bpp)) return undefined;

  // 调色板：在文件头（和跟在后面的掩码）之后
  let palette: Uint8Array | undefined;
  if (bpp <= 8) {
    const n = Math.min(colors || 1 << bpp, 256);
    const at = 14 + hs + (hs === 40 && (comp === 3 || comp === 6) ? (masks?.length ?? 0) * 4 : 0);
    palette = new Uint8Array(256 * 4);
    for (let i = 0; i < n && at + i * palEntry + 2 < b.length; i++) {
      const o = at + i * palEntry;
      palette[i * 4] = b[o + 2]; palette[i * 4 + 1] = b[o + 1]; palette[i * 4 + 2] = b[o]; palette[i * 4 + 3] = 255;
    }
  }
  const out = new Uint8Array(w * h * 4);
  const put = (x: number, y: number, r: number, g: number, bl: number, a: number) => {
    const o = ((topDown ? y : h - 1 - y) * w + x) * 4;
    out[o] = r; out[o + 1] = g; out[o + 2] = bl; out[o + 3] = a;
  };
  const index = (x: number, y: number, i: number) => {
    const p = i * 4;
    put(x, y, palette![p], palette![p + 1], palette![p + 2], 255);
  };
  if (comp === 1 || comp === 2) {
    // RLE：y 从文件里的第一行（最下面一行）数起；没写到的像素是调色板第 0 色
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) index(x, y, 0);
    rle(b, offBits, comp === 1 ? 8 : 4, w, h, (x, y, i) => index(x, y, i));
    return { width: w, height: h, data: out, alpha: false };
  }
  const stride = ((w * bpp + 31) >> 5) * 4;
  if (offBits + stride * (h - 1) + Math.ceil((w * bpp) / 8) > b.length) return undefined;
  const [fr, fg, fb, fa] = (masks ?? []).map(field);
  let alpha = false;
  for (let y = 0; y < h; y++) {
    const row = offBits + y * stride;
    for (let x = 0; x < w; x++) {
      if (bpp <= 8) {
        const bit = x * bpp, v = b[row + (bit >> 3)];
        index(x, y, bpp === 8 ? v : (v >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1));
      } else if (bpp === 24) {
        const o = row + x * 3;
        put(x, y, b[o + 2], b[o + 1], b[o], 255);
      } else {
        const v = bpp === 16 ? d.getUint16(row + x * 2, true) : d.getUint32(row + x * 4, true);
        if (!masks) { put(x, y, (v >>> 16) & 255, (v >>> 8) & 255, v & 255, 255); continue; }
        const a = fa ? fa(v) : 255;
        if (a < 255) alpha = true;
        put(x, y, fr ? fr(v) : 0, fg ? fg(v) : 0, fb ? fb(v) : 0, a);
      }
    }
  }
  return { width: w, height: h, data: out, alpha };
}

/** RLE8 / RLE4 解压：按（列, 从下往上数的行, 调色板编号）回调 */
function rle(b: Uint8Array, at: number, bits: 4 | 8, w: number, h: number, set: (x: number, y: number, i: number) => void) {
  let x = 0, y = 0, p = at;
  const pix = (i: number) => { if (x < w && y < h) set(x, y, i); x++; };
  while (p + 1 < b.length && y < h) {
    const n = b[p], c = b[p + 1];
    p += 2;
    if (n > 0) {
      for (let k = 0; k < n; k++) pix(bits === 8 ? c : k & 1 ? c & 15 : c >> 4);
    } else if (c === 0) { x = 0; y++; }
    else if (c === 1) break;
    else if (c === 2) { if (p + 1 >= b.length) break; x += b[p]; y += b[p + 1]; p += 2; }
    else {
      // 不压缩的一段：c 个像素，按 2 字节对齐
      const bytes = bits === 8 ? c : Math.ceil(c / 2);
      for (let k = 0; k < c && p + (bits === 8 ? k : k >> 1) < b.length; k++) {
        const v = b[p + (bits === 8 ? k : k >> 1)];
        pix(bits === 8 ? v : k & 1 ? v & 15 : v >> 4);
      }
      p += bytes + (bytes & 1);
    }
  }
}
