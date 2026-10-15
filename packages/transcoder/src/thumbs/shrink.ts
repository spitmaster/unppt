/**
 * 缩略图里的图片：解码、缩小到最长边不超过 max（区域平均），没有透明的存 JPEG、有透明的存 PNG，返回 data URI。
 * 解不开的格式（GIF、BMP、WebP、SVG……）不大的原样内嵌，太大的不放（缩略图里那块空着）。
 */
import { base64 } from '../media/media';
import { decodeJpeg } from '../media/jpeg';
import { encodeJpeg } from '../media/jpeg-encode';
import { encodeRgba } from '../media/png';
import { decodePng, type RgbaImage } from '../media/png-decode';

/** 解不开的图片，原样内嵌的大小上限 */
const RAW_MAX = 96 * 1024;
const JPEG_QUALITY = 80;

const MIME: [number[], string][] = [[[0x47, 0x49, 0x46], 'image/gif'], [[0x42, 0x4d], 'image/bmp'], [[0x52, 0x49, 0x46, 0x46], 'image/webp'], [[0x3c], 'image/svg+xml']];

export async function shrinkImage(bytes: Uint8Array, max: number): Promise<string | undefined> {
  const img = await decode(bytes);
  if (!img) {
    if (bytes.length > RAW_MAX) return undefined;
    const mime = MIME.find(([sig]) => sig.every((v, i) => bytes[i] === v))?.[1];
    return mime ? `data:${mime};base64,${base64(bytes)}` : undefined;
  }
  const small = resize(img, max);
  let opaque = true;
  for (let i = 3; i < small.data.length; i += 4) if (small.data[i] < 255) { opaque = false; break; }
  if (opaque) {
    const rgb = new Uint8Array(small.width * small.height * 3);
    for (let i = 0, j = 0; i < small.data.length; i += 4, j += 3) { rgb[j] = small.data[i]; rgb[j + 1] = small.data[i + 1]; rgb[j + 2] = small.data[i + 2]; }
    return `data:image/jpeg;base64,${base64(encodeJpeg(rgb, small.width, small.height, JPEG_QUALITY))}`;
  }
  const png = await encodeRgba(small.data, small.width, small.height);
  return png ? `data:image/png;base64,${base64(png)}` : undefined;
}

async function decode(b: Uint8Array): Promise<RgbaImage | undefined> {
  if (b[0] === 0x89) return decodePng(b);
  if (b[0] !== 0xff || b[1] !== 0xd8) return undefined;
  const j = decodeJpeg(b);
  if (!j) return undefined;
  const data = new Uint8Array(j.width * j.height * 4);
  for (let i = 0, k = 0; i < j.data.length; i += 3, k += 4) { data[k] = j.data[i]; data[k + 1] = j.data[i + 1]; data[k + 2] = j.data[i + 2]; data[k + 3] = 255; }
  return { width: j.width, height: j.height, data };
}

/** 区域平均缩小（透明度加权，避免透明像素的颜色渗出来）；本来就够小的不动 */
function resize(img: RgbaImage, max: number): RgbaImage {
  const k = max / Math.max(img.width, img.height);
  if (k >= 1) return img;
  const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * img.height) / h), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * img.height) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * img.width) / w), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * img.width) / w));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const o = (yy * img.width + xx) * 4, al = img.data[o + 3];
        r += img.data[o] * al; g += img.data[o + 1] * al; b += img.data[o + 2] * al; a += al; n++;
      }
      const o = (y * w + x) * 4;
      if (a) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); }
      out[o + 3] = Math.round(a / n);
    }
  }
  return { width: w, height: h, data: out };
}
