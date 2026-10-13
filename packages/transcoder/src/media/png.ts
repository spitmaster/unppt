/** PNG 的分块读写、行过滤还原、RGBA 编码（"设置透明色"在原图上抠时用；压缩、解压用内置的压缩流） */

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
/** 解压后超过这个字节数的不做（防止异常文件占满内存） */
export const MAX_RAW = 256 * 1024 * 1024;

export interface Chunk { type: string; data: Uint8Array }

export function readChunks(b: Uint8Array): Chunk[] | undefined {
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

export function writeChunks(cs: Chunk[]): Uint8Array {
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

/** PNG 的五种行过滤（None、Sub、Up、Average、Paeth）还原 */
export function unfilter(f: number, src: Uint8Array, row: Uint8Array, up: Uint8Array | undefined, bpp: number): boolean {
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

/**
 * 按行过滤后压缩成 IDAT 的数据：每行在五种过滤里选残差绝对值之和最小的（PNG 规范推荐的做法，照片类图片能小一半以上）
 */
export function idatOf(px: Uint8Array, stride: number, h: number, bpp: number): Promise<Uint8Array | undefined> {
  const filtered = new Uint8Array((stride + 1) * h);
  const cand = Array.from({ length: 5 }, () => new Uint8Array(stride));
  for (let y = 0; y < h; y++) {
    const row = px.subarray(y * stride, (y + 1) * stride);
    const up = y > 0 ? px.subarray((y - 1) * stride, y * stride) : undefined;
    let best = 0, bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      const out = cand[f];
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? row[i - bpp] : 0, b = up ? up[i] : 0, c = up && i >= bpp ? up[i - bpp] : 0;
        let p = 0;
        if (f === 1) p = a;
        else if (f === 2) p = b;
        else if (f === 3) p = (a + b) >> 1;
        else if (f === 4) {
          const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c);
          p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        const v = (row[i] - p) & 0xff;
        out[i] = v;
        sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) { bestSum = sum; best = f; }
    }
    filtered[y * (stride + 1)] = best;
    filtered.set(cand[best], y * (stride + 1) + 1);
  }
  return transform(filtered, new CompressionStream('deflate'));
}

/** 8 位 RGBA 像素编码成 PNG */
export async function encodeRgba(px: Uint8Array, w: number, h: number): Promise<Uint8Array | undefined> {
  const z = await idatOf(px, w * 4, h, 4);
  if (!z) return undefined;
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return writeChunks([{ type: 'IHDR', data: ihdr }, { type: 'IDAT', data: z }, { type: 'IEND', data: new Uint8Array(0) }]);
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** 用内置的（解）压缩流处理一段字节；数据有问题时返回 undefined */
export async function transform(data: Uint8Array, ts: { writable: WritableStream<BufferSource>; readable: ReadableStream<Uint8Array> }): Promise<Uint8Array | undefined> {
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
