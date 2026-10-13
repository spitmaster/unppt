/**
 * 图片"设置透明色"（a:clrChange）在原图像素上做。PowerPoint 先在原图上把这个颜色抠掉再缩放；
 * SVG 滤镜只能作用在缩放后的像素上，边缘混进了要抠的颜色，会留一圈亮边。PNG 可以在原图上做：
 *   - 灰度、真彩色、调色板（没有透明通道）：只加一个 tRNS 块，像素数据不动
 *     （调色板里和目标色每个通道差不超过 1 的都变透明，和 PowerPoint 的阈值一样；真彩色只能精确匹配）；
 *   - 带透明通道（8 位、不隔行）：解压、逐像素抠掉、再压缩。
 * 做不了的（不是 PNG、16 位带透明通道、隔行……）返回 undefined，调用方退回滤镜近似。
 */
import type { Rgba } from '../model/color';

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
/** 解压后超过这个字节数的不做（防止异常文件占满内存） */
const MAX_RAW = 256 * 1024 * 1024;

interface Chunk { type: string; data: Uint8Array }

function readChunks(b: Uint8Array): Chunk[] | undefined {
  if (b.length < 8 || SIG.some((v, i) => b[i] !== v)) return undefined;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: Chunk[] = [];
  for (let o = 8; o + 12 <= b.length;) {
    const len = dv.getUint32(o);
    if (o + 12 + len > b.length) return undefined;
    const type = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
    out.push({ type, data: b.subarray(o + 8, o + 8 + len) });
    o += 12 + len;
    if (type === 'IEND') return out;
  }
  return undefined;
}

let crcTable: Uint32Array | undefined;
function crc32(type: Uint8Array, data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const part of [type, data]) for (let i = 0; i < part.length; i++) c = crcTable[(c ^ part[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function writeChunks(cs: Chunk[]): Uint8Array {
  const out = new Uint8Array(8 + cs.reduce((n, c) => n + 12 + c.data.length, 0));
  const dv = new DataView(out.buffer);
  out.set(SIG);
  let o = 8;
  for (const c of cs) {
    const type = Uint8Array.from(c.type, (ch) => ch.charCodeAt(0));
    dv.setUint32(o, c.data.length);
    out.set(type, o + 4);
    out.set(c.data, o + 8);
    dv.setUint32(o + 8 + c.data.length, crc32(type, c.data));
    o += 12 + c.data.length;
  }
  return out;
}

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

/** 带透明通道的 PNG：解压、还原行过滤、把接近 key 的像素透明度设成 0，再按"无过滤"压缩 */
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
  const filtered = new Uint8Array((stride + 1) * h);
  for (let y = 0; y < h; y++) filtered.set(px.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const z = await transform(filtered, new CompressionStream('deflate'));
  if (!z) return undefined;
  const first = cs.findIndex((c) => c.type === 'IDAT');
  const out = cs.filter((c, i) => c.type !== 'IDAT' || i === first).map((c) => (c.type === 'IDAT' ? { type: 'IDAT', data: z } : c));
  return writeChunks(out);
}

/** PNG 的五种行过滤（None、Sub、Up、Average、Paeth）还原 */
function unfilter(f: number, src: Uint8Array, row: Uint8Array, up: Uint8Array | undefined, bpp: number): boolean {
  if (f > 4) return false;
  for (let i = 0; i < src.length; i++) {
    const a = i >= bpp ? row[i - bpp] : 0, b = up ? up[i] : 0, c = up && i >= bpp ? up[i - bpp] : 0;
    let p = 0;
    if (f === 1) p = a;
    else if (f === 2) p = b;
    else if (f === 3) p = (a + b) >> 1;
    else if (f === 4) {
      const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c);
      p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
    row[i] = (src[i] + p) & 0xff;
  }
  return true;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** 用内置的（解）压缩流处理一段字节；数据有问题时返回 undefined */
async function transform(data: Uint8Array, ts: { writable: WritableStream<BufferSource>; readable: ReadableStream<Uint8Array> }): Promise<Uint8Array | undefined> {
  const writer = ts.writable.getWriter();
  writer.write(data as Uint8Array<ArrayBuffer>).catch(() => {});
  writer.close().catch(() => {});
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    const reader = ts.readable.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_RAW + 1024 * 1024) { await reader.cancel().catch(() => {}); return undefined; }
      parts.push(value);
    }
  } catch {
    return undefined;
  }
  return concat(parts);
}
