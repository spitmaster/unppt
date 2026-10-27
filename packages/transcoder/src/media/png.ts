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

/**
 * PNG 的五种行过滤（None、Sub、Up、Average、Paeth）还原。每种过滤一个循环、行首 bpp 个字节（左边没有像素）单独算：
 * 出图时按画的大小缩小 PNG 要逐行还原整张图，逐字节判断过滤类型要慢几倍
 */
export function unfilter(f: number, src: Uint8Array, row: Uint8Array, up: Uint8Array | undefined, bpp: number): boolean {
  if (f > 4) return false;
  const n = src.length, m = Math.min(bpp, n);
  if (f === 0) row.set(src.subarray(0, n));
  else if (f === 1) {
    for (let i = 0; i < m; i++) row[i] = src[i];
    for (let i = m; i < n; i++) row[i] = (src[i] + row[i - bpp]) & 0xff;
  } else if (!up) {
    // 第一行：上一行当成全 0（Up 等于 None，Average 只看左边，Paeth 等于 Sub）
    if (f === 2) row.set(src.subarray(0, n));
    else if (f === 3) {
      for (let i = 0; i < m; i++) row[i] = src[i];
      for (let i = m; i < n; i++) row[i] = (src[i] + (row[i - bpp] >> 1)) & 0xff;
    } else {
      for (let i = 0; i < m; i++) row[i] = src[i];
      for (let i = m; i < n; i++) row[i] = (src[i] + row[i - bpp]) & 0xff;
    }
  } else if (f === 2) {
    for (let i = 0; i < n; i++) row[i] = (src[i] + up[i]) & 0xff;
  } else if (f === 3) {
    for (let i = 0; i < m; i++) row[i] = (src[i] + (up[i] >> 1)) & 0xff;
    for (let i = m; i < n; i++) row[i] = (src[i] + ((row[i - bpp] + up[i]) >> 1)) & 0xff;
  } else {
    for (let i = 0; i < m; i++) row[i] = (src[i] + up[i]) & 0xff;
    for (let i = m; i < n; i++) {
      const a = row[i - bpp], b = up[i], c = up[i - bpp];
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      row[i] = (src[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
    }
  }
  return true;
}

/**
 * 按行过滤后压缩成 IDAT 的数据：每行在五种过滤里选残差绝对值之和最小的（并列取编号小的；PNG 规范推荐的做法，照片类图片能小一半以上）。
 * 先一遍算出五种过滤的和，再只写选中的那种；行首 bpp 个字节（左边没有像素）单独算，后面的循环里不再判断
 */
export function idatOf(px: Uint8Array, stride: number, h: number, bpp: number): Promise<Uint8Array | undefined> {
  const filtered = new Uint8Array((stride + 1) * h);
  const zero = new Uint8Array(stride);
  const n = Math.min(bpp, stride);
  for (let y = 0; y < h; y++) {
    const r = y * stride;
    // 第一行的"上一行"当成全 0
    const up = y > 0 ? px : zero, u = y > 0 ? r - stride : 0;
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0;
    for (let i = 0; i < n; i++) {
      const x = px[r + i], b = up[u + i];
      s0 += cost(x); s1 += cost(x); s2 += cost((x - b) & 0xff); s3 += cost((x - (b >> 1)) & 0xff); s4 += cost((x - b) & 0xff);
    }
    for (let i = n; i < stride; i++) {
      const x = px[r + i], a = px[r + i - bpp], b = up[u + i], c = up[u + i - bpp];
      s0 += cost(x);
      s1 += cost((x - a) & 0xff);
      s2 += cost((x - b) & 0xff);
      s3 += cost((x - ((a + b) >> 1)) & 0xff);
      s4 += cost((x - paeth(a, b, c)) & 0xff);
    }
    let best = 0, bs = s0;
    if (s1 < bs) { bs = s1; best = 1; }
    if (s2 < bs) { bs = s2; best = 2; }
    if (s3 < bs) { bs = s3; best = 3; }
    if (s4 < bs) best = 4;
    const o = y * (stride + 1) + 1;
    filtered[o - 1] = best;
    if (best === 0) filtered.set(px.subarray(r, r + stride), o);
    else if (best === 2) for (let i = 0; i < stride; i++) filtered[o + i] = (px[r + i] - up[u + i]) & 0xff;
    else {
      for (let i = 0; i < n; i++) filtered[o + i] = (px[r + i] - (best === 1 ? 0 : best === 3 ? up[u + i] >> 1 : up[u + i])) & 0xff;
      if (best === 1) for (let i = n; i < stride; i++) filtered[o + i] = (px[r + i] - px[r + i - bpp]) & 0xff;
      else if (best === 3) for (let i = n; i < stride; i++) filtered[o + i] = (px[r + i] - ((px[r + i - bpp] + up[u + i]) >> 1)) & 0xff;
      else for (let i = n; i < stride; i++) filtered[o + i] = (px[r + i] - paeth(px[r + i - bpp], up[u + i], up[u + i - bpp])) & 0xff;
    }
  }
  return transform(filtered, new CompressionStream('deflate'));
}

/** 残差按有符号字节的绝对值计 */
function cost(v: number): number {
  return v < 128 ? v : 256 - v;
}

function paeth(a: number, b: number, c: number): number {
  const q = a + b - c, pa = q > a ? q - a : a - q, pb = q > b ? q - b : b - q, pc = q > c ? q - c : c - q;
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** 8 位 RGBA 像素编码成 PNG */
export function encodeRgba(px: Uint8Array, w: number, h: number): Promise<Uint8Array | undefined> {
  return encodePixels(px, w, h, 4);
}

/** 8 位像素编码成 PNG：channels 4 是 RGBA，3 是 RGB（没有透明通道） */
export async function encodePixels(px: Uint8Array, w: number, h: number, channels: 3 | 4): Promise<Uint8Array | undefined> {
  const z = await idatOf(px, w * channels, h, channels);
  if (!z) return undefined;
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = channels === 4 ? 6 : 2;
  return writeChunks([{ type: 'IHDR', data: ihdr }, { type: 'IDAT', data: z }, { type: 'IEND', data: new Uint8Array(0) }]);
}

/**
 * 不压缩的 PNG（zlib 的存储块，每行不过滤）：只在出图时交给 resvg 读（preview/fit-images.ts），省掉压缩的时间；文件大小是像素数 × 通道数
 */
export function encodeStored(px: Uint8Array, w: number, h: number, channels: 3 | 4): Uint8Array {
  const stride = w * channels;
  const raw = new Uint8Array((stride + 1) * h);
  for (let y = 0; y < h; y++) raw.set(px.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const BLOCK = 65535, blocks = Math.max(1, Math.ceil(raw.length / BLOCK));
  const z = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  z[0] = 0x78; z[1] = 0x01;
  let o = 2;
  for (let i = 0; i < blocks; i++) {
    const len = Math.min(BLOCK, raw.length - i * BLOCK);
    z[o] = i === blocks - 1 ? 1 : 0;
    z[o + 1] = len & 0xff; z[o + 2] = len >> 8; z[o + 3] = ~len & 0xff; z[o + 4] = (~len >> 8) & 0xff;
    z.set(raw.subarray(i * BLOCK, i * BLOCK + len), o + 5);
    o += 5 + len;
  }
  // Adler-32（每 5552 字节取一次模，不会溢出）
  let a = 1, b = 0;
  for (let i = 0; i < raw.length;) {
    const end = Math.min(raw.length, i + 5552);
    for (; i < end; i++) { a += raw[i]; b += a; }
    a %= 65521; b %= 65521;
  }
  z[o] = b >> 8; z[o + 1] = b & 0xff; z[o + 2] = a >> 8; z[o + 3] = a & 0xff;
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = channels === 4 ? 6 : 2;
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
