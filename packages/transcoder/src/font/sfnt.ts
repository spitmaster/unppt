/**
 * sfnt（TrueType 字体文件）的读写公共部分：按字节写入、表校验和、表目录。
 * 子集化（subset.ts）和嵌入字体还原（ctf.ts）共用。
 */

export const be16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
export const bes16 = (b: Uint8Array, o: number) => { const v = be16(b, o); return v & 0x8000 ? v - 0x10000 : v; };
export const be32 = (b: Uint8Array, o: number) => (b[o] * 0x1000000) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
export const tagOf = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

export class Writer {
  private buf = new Uint8Array(1024);
  len = 0;
  private ensure(n: number) {
    if (this.len + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + n) size *= 2;
    const nb = new Uint8Array(size);
    nb.set(this.buf.subarray(0, this.len));
    this.buf = nb;
  }
  u8(v: number) { this.ensure(1); this.buf[this.len++] = v & 255; }
  u16(v: number) { this.ensure(2); this.buf[this.len++] = (v >> 8) & 255; this.buf[this.len++] = v & 255; }
  u32(v: number) { this.ensure(4); this.u16(Math.floor(v / 0x10000) & 0xffff); this.u16(v & 0xffff); }
  bytes(b: Uint8Array) { this.ensure(b.length); this.buf.set(b, this.len); this.len += b.length; }
  pad4() { while (this.len % 4) this.u8(0); }
  done() { return this.buf.slice(0, this.len); }
}

export function checksum(b: Uint8Array): number {
  let sum = 0;
  const n = Math.ceil(b.length / 4) * 4;
  for (let i = 0; i < n; i += 4) {
    sum = (sum + ((b[i] ?? 0) * 0x1000000 + ((b[i + 1] ?? 0) << 16) + ((b[i + 2] ?? 0) << 8) + (b[i + 3] ?? 0))) % 0x100000000;
  }
  return sum;
}

export type SfntTables = [string, Uint8Array][];

/** 读内存里一个 TTF 的表目录：标签 -> 表数据（不复制） */
export function readSfnt(b: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const n = be16(b, 4);
  for (let i = 0; i < n; i++) {
    const r = 12 + i * 16, off = be32(b, r + 8), len = be32(b, r + 12);
    if (off + len <= b.length) out.set(tagOf(b, r), b.subarray(off, off + len));
  }
  return out;
}

function directory(tables: SfntTables): Uint8Array {
  const w = new Writer();
  let es = 0; while ((1 << (es + 1)) <= tables.length) es++;
  w.u32(0x00010000); w.u16(tables.length); w.u16(16 << es); w.u16(es); w.u16(tables.length * 16 - (16 << es));
  let off = 12 + tables.length * 16;
  for (const [tg, d] of tables) {
    for (let i = 0; i < 4; i++) w.u8(tg.charCodeAt(i));
    w.u32(checksum(d)); w.u32(off); w.u32(d.length);
    off += Math.ceil(d.length / 4) * 4;
  }
  return w.done();
}

/**
 * 表按标签排序，并把整个字体的校验调整值写进 head（head 表数据会被就地改写）。
 * 返回排好序的表，可以直接拼成 TTF 或打包成 WOFF。
 */
export function finishTables(tables: SfntTables): SfntTables {
  const sorted = tables.filter(([, d]) => d.length > 0).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const head = sorted.find(([t]) => t === 'head')?.[1];
  if (!head) return sorted;
  head[8] = head[9] = head[10] = head[11] = 0;
  let sum = checksum(directory(sorted));
  for (const [, d] of sorted) sum = (sum + checksum(d)) % 0x100000000;
  const adj = (0xb1b0afba - sum + 0x100000000) % 0x100000000;
  head[8] = (adj >>> 24) & 255; head[9] = (adj >>> 16) & 255; head[10] = (adj >>> 8) & 255; head[11] = adj & 255;
  return sorted;
}

/** 把（finishTables 处理过的）表拼成 TTF 文件 */
export function writeSfnt(tables: SfntTables): Uint8Array {
  const w = new Writer();
  w.bytes(directory(tables));
  for (const [, d] of tables) { w.bytes(d); w.pad4(); }
  return w.done();
}
