/**
 * PNG 解码成 8 位 RGBA（缩略图缩小图片时用）：五种颜色类型（灰度、真彩色、调色板、灰度+透明、真彩色+透明）、
 * 1/2/4/8/16 位、tRNS 透明色、Adam7 隔行。解不开、太大的返回 undefined。
 */
import { concat, MAX_RAW, readChunks, transform, unfilter } from './png';

export interface RgbaImage { width: number; height: number; data: Uint8Array }

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
/** Adam7 的 7 遍：起点和步长（x0, y0, dx, dy） */
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];

export async function decodePng(bytes: Uint8Array): Promise<RgbaImage | undefined> {
  const cs = readChunks(bytes);
  const ihdr = cs?.[0];
  if (!cs || ihdr?.type !== 'IHDR' || ihdr.data.length < 13) return undefined;
  const d = ihdr.data;
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const w = dv.getUint32(0), h = dv.getUint32(4), depth = d[8], type = d[9], interlace = d[12];
  const ch = CHANNELS[type];
  if (!ch || !w || !h || w * h * 4 > MAX_RAW) return undefined;
  const idat = cs.filter((c) => c.type === 'IDAT');
  if (!idat.length) return undefined;
  const raw = await transform(concat(idat.map((c) => c.data)), new DecompressionStream('deflate'));
  if (!raw) return undefined;
  const plte = cs.find((c) => c.type === 'PLTE')?.data;
  const trns = cs.find((c) => c.type === 'tRNS')?.data;
  const out = new Uint8Array(w * h * 4);
  const bitsPP = ch * depth, bpp = Math.max(1, bitsPP >> 3);
  // 一个像素的第 k 个通道（按位深取，换算到 0~255；16 位取高字节）
  const sample = (row: Uint8Array, x: number, k: number) => {
    if (depth === 8) return row[x * ch + k];
    if (depth === 16) return row[(x * ch + k) * 2];
    const bit = (x * ch + k) * depth;
    const v = (row[bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
    return type === 3 ? v : Math.round((v * 255) / ((1 << depth) - 1));
  };
  const rawSample = (row: Uint8Array, x: number, k: number) => {
    if (depth === 16) return (row[(x * ch + k) * 2] << 8) | row[(x * ch + k) * 2 + 1];
    if (depth === 8) return row[x * ch + k];
    const bit = (x * ch + k) * depth;
    return (row[bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
  };
  const tr16 = trns && trns.length >= 2 ? [0, 2, 4].map((o) => (trns[o] << 8) | trns[o + 1]) : undefined;
  const put = (row: Uint8Array, x: number, px: number) => {
    const o = px * 4;
    if (type === 3) {
      const i = sample(row, x, 0);
      if (!plte || i * 3 + 2 >= plte.length) return;
      out[o] = plte[i * 3]; out[o + 1] = plte[i * 3 + 1]; out[o + 2] = plte[i * 3 + 2];
      out[o + 3] = trns && i < trns.length ? trns[i] : 255;
    } else if (type === 0 || type === 4) {
      const g = sample(row, x, 0);
      out[o] = out[o + 1] = out[o + 2] = g;
      out[o + 3] = type === 4 ? sample(row, x, 1) : tr16 && rawSample(row, x, 0) === tr16[0] ? 0 : 255;
    } else {
      out[o] = sample(row, x, 0); out[o + 1] = sample(row, x, 1); out[o + 2] = sample(row, x, 2);
      out[o + 3] = type === 6 ? sample(row, x, 3) : tr16 && tr16.length === 3 && rawSample(row, x, 0) === tr16[0] && rawSample(row, x, 1) === tr16[1] && rawSample(row, x, 2) === tr16[2] ? 0 : 255;
    }
  };
  let pos = 0;
  // 解一遍（隔行时是一遍里的子图）：pw × ph 个像素，放到 (x0 + i·dx, y0 + j·dy)
  const pass = (pw: number, ph: number, x0: number, y0: number, dx: number, dy: number): boolean => {
    if (!pw || !ph) return true;
    const stride = Math.ceil((pw * bitsPP) / 8);
    let up: Uint8Array | undefined;
    for (let j = 0; j < ph; j++) {
      if (pos + 1 + stride > raw.length) return false;
      const row = new Uint8Array(stride);
      if (!unfilter(raw[pos], raw.subarray(pos + 1, pos + 1 + stride), row, up, bpp)) return false;
      pos += 1 + stride;
      for (let i = 0; i < pw; i++) put(row, i, (y0 + j * dy) * w + x0 + i * dx);
      up = row;
    }
    return true;
  };
  if (interlace) {
    for (const [x0, y0, dx, dy] of ADAM7) {
      if (!pass(Math.max(0, Math.ceil((w - x0) / dx)), Math.max(0, Math.ceil((h - y0) / dy)), x0, y0, dx, dy)) return undefined;
    }
  } else if (!pass(w, h, 0, 0, 1, 1)) return undefined;
  return { width: w, height: h, data: out };
}
