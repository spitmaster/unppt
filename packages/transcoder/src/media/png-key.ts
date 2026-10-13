/**
 * PNG 的"设置透明色"（入口和阈值见 color-key.ts）：
 *   - 灰度、真彩色、调色板（没有透明通道）：只加一个 tRNS 块，像素数据不动
 *     （调色板里和目标色每个通道差不超过 1 的都变透明，和 PowerPoint 的阈值一样；真彩色只能精确匹配）；
 *   - 带透明通道（8 位、不隔行）：解压、逐像素抠掉、再压缩。
 * 做不了的（16 位带透明通道、隔行……）返回 undefined。
 */
import type { Rgba } from '../model/color';
import { concat, idatOf, MAX_RAW, readChunks, transform, unfilter, writeChunks, type Chunk } from './png';

const near = (a: number, b: number) => Math.abs(a - b) <= 1;
const u16 = (vs: number[]) => Uint8Array.from(vs.flatMap((v) => [(v >> 8) & 0xff, v & 0xff]));

/** 把 PNG 里的 key 颜色变透明，返回新的 PNG；做不了时返回 undefined */
export async function pngColorKey(bytes: Uint8Array, key: Rgba): Promise<Uint8Array | undefined> {
  const cs = readChunks(bytes);
  const ihdr = cs?.[0];
  if (!cs || ihdr?.type !== 'IHDR' || ihdr.data.length < 13) return undefined;
  const d = ihdr.data;
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const w = dv.getUint32(0), h = dv.getUint32(4), depth = d[8], type = d[9], interlace = d[12];
  let trns: Uint8Array;
  if (type === 2) {
    if (depth !== 8 && depth !== 16) return undefined;
    const s = depth === 16 ? 257 : 1;
    trns = u16([key.r * s, key.g * s, key.b * s]);
  } else if (type === 0) {
    // 灰度：目标色是灰色、并且这个位深能精确表示时才做
    const max = (1 << depth) - 1;
    if (key.r !== key.g || key.g !== key.b || (key.r * max) % 255 !== 0) return undefined;
    trns = u16([(key.r * max) / 255]);
  } else if (type === 3) {
    const plte = cs.find((c) => c.type === 'PLTE')?.data;
    if (!plte) return undefined;
    const old = cs.find((c) => c.type === 'tRNS')?.data ?? new Uint8Array(0);
    const n = Math.floor(plte.length / 3);
    const alpha = new Uint8Array(n).fill(255);
    alpha.set(old.subarray(0, n));
    let len = Math.min(old.length, n);
    for (let i = 0; i < n; i++) {
      if (near(plte[3 * i], key.r) && near(plte[3 * i + 1], key.g) && near(plte[3 * i + 2], key.b)) { alpha[i] = 0; len = Math.max(len, i + 1); }
    }
    trns = alpha.subarray(0, len);
  } else if ((type === 6 || type === 4) && depth === 8 && interlace === 0) {
    return keyAlphaPixels(cs, w, h, type === 6 ? 4 : 2, key);
  } else {
    return undefined;
  }
  // tRNS 要在 PLTE 之后、第一个 IDAT 之前
  const out = cs.filter((c) => c.type !== 'tRNS');
  const at = out.findIndex((c) => c.type === 'IDAT');
  if (at < 0) return undefined;
  out.splice(at, 0, { type: 'tRNS', data: trns });
  return writeChunks(out);
}

/** 带透明通道的 PNG：解压、还原行过滤、把接近 key 的像素透明度设成 0，再重新过滤、压缩 */
async function keyAlphaPixels(cs: Chunk[], w: number, h: number, bpp: number, key: Rgba): Promise<Uint8Array | undefined> {
  const stride = w * bpp;
  if (!w || !h || (stride + 1) * h > MAX_RAW) return undefined;
  const idat = cs.filter((c) => c.type === 'IDAT');
  if (!idat.length) return undefined;
  const raw = await transform(concat(idat.map((c) => c.data)), new DecompressionStream('deflate'));
  if (!raw || raw.length < (stride + 1) * h) return undefined;
  const px = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = px.subarray(y * stride, (y + 1) * stride);
    const up = y > 0 ? px.subarray((y - 1) * stride, y * stride) : undefined;
    if (!unfilter(f, src, row, up, bpp)) return undefined;
  }
  const gray = bpp === 2;
  for (let i = 0; i < px.length; i += bpp) {
    const r = px[i], g = gray ? r : px[i + 1], b = gray ? r : px[i + 2];
    if (near(r, key.r) && near(g, key.g) && near(b, key.b)) px[i + bpp - 1] = 0;
  }
  const z = await idatOf(px, stride, h, bpp);
  if (!z) return undefined;
  const first = cs.findIndex((c) => c.type === 'IDAT');
  const out = cs.filter((c, i) => c.type !== 'IDAT' || i === first).map((c) => (c.type === 'IDAT' ? { type: 'IDAT', data: z } : c));
  return writeChunks(out);
}
