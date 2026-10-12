/**
 * 只读 zip 解析：先读文件末尾的中央目录，之后按需读取单个条目。
 * 不把整个 zip 读进内存；解压用内置的 DecompressionStream('deflate-raw')。
 * 支持 ZIP64（超过 4GB 或条目超过 65535 个的文件）。
 */
import type { RandomAccessSource } from './source';

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localHeaderOffset: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;
const CHUNK = 1 << 20;

const utf8 = new TextDecoder('utf-8');

function u16(b: Uint8Array, o: number) { return b[o] | (b[o + 1] << 8); }
function u32(b: Uint8Array, o: number) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000; }
function u64(b: Uint8Array, o: number) { return u32(b, o) + u32(b, o + 4) * 0x100000000; }

export class ZipReader {
  private entries = new Map<string, ZipEntry>();
  private lowerNames = new Map<string, string>();

  private constructor(private src: RandomAccessSource) {}

  static async open(src: RandomAccessSource): Promise<ZipReader> {
    const z = new ZipReader(src);
    await z.readDirectory();
    return z;
  }

  private async readDirectory() {
    const { src } = this;
    const tailLen = Math.min(src.size, 22 + 0xffff + 20);
    const tail = await src.read(src.size - tailLen, tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (u32(tail, i) === SIG_EOCD) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 pptx 文件（找不到 zip 目录）');
    let count = u16(tail, eocd + 10);
    let cdSize = u32(tail, eocd + 12);
    let cdOffset = u32(tail, eocd + 16);
    const loc = eocd - 20;
    if (loc >= 0 && u32(tail, loc) === SIG_EOCD64_LOCATOR) {
      const eocd64Offset = u64(tail, loc + 8);
      const e64 = await src.read(eocd64Offset, 56);
      count = u64(e64, 32);
      cdSize = u64(e64, 40);
      cdOffset = u64(e64, 48);
    }
    const cd = await src.read(cdOffset, cdSize);
    let p = 0;
    for (let i = 0; i < count && p + 46 <= cd.length; i++) {
      if (u32(cd, p) !== SIG_CEN) throw new Error('zip 目录损坏');
      const method = u16(cd, p + 10);
      let compressedSize = u32(cd, p + 20);
      let size = u32(cd, p + 24);
      const nameLen = u16(cd, p + 28);
      const extraLen = u16(cd, p + 30);
      const commentLen = u16(cd, p + 32);
      let localHeaderOffset = u32(cd, p + 42);
      const name = utf8.decode(cd.subarray(p + 46, p + 46 + nameLen));
      // ZIP64 扩展字段
      let e = p + 46 + nameLen;
      const eEnd = e + extraLen;
      while (e + 4 <= eEnd) {
        const id = u16(cd, e);
        const len = u16(cd, e + 2);
        if (id === 0x0001) {
          let q = e + 4;
          if (size === 0xffffffff) { size = u64(cd, q); q += 8; }
          if (compressedSize === 0xffffffff) { compressedSize = u64(cd, q); q += 8; }
          if (localHeaderOffset === 0xffffffff) { localHeaderOffset = u64(cd, q); }
        }
        e += 4 + len;
      }
      const entry = { name, method, compressedSize, size, localHeaderOffset };
      this.entries.set(name, entry);
      this.lowerNames.set(name.toLowerCase(), name);
      p = eEnd + commentLen;
    }
  }

  /** 按名字查找条目（OOXML 里的部件名大小写不敏感） */
  entry(name: string): ZipEntry | undefined {
    const n = name.replace(/^\//, '');
    return this.entries.get(n) ?? this.entries.get(this.lowerNames.get(n.toLowerCase()) ?? '');
  }

  names(): string[] {
    return [...this.entries.keys()];
  }

  private async dataOffset(entry: ZipEntry): Promise<number> {
    const h = await this.src.read(entry.localHeaderOffset, 30);
    if (u32(h, 0) !== SIG_LOC) throw new Error(`zip 条目损坏: ${entry.name}`);
    return entry.localHeaderOffset + 30 + u16(h, 26) + u16(h, 28);
  }

  /** 读出整个条目（适合 XML 等小文件） */
  async read(name: string): Promise<Uint8Array | undefined> {
    const entry = this.entry(name);
    if (!entry) return undefined;
    const parts: Uint8Array[] = [];
    let total = 0;
    for await (const c of this.stream(entry)) { parts.push(c); total += c.length; }
    if (parts.length === 1) return parts[0];
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of parts) { out.set(c, o); o += c.length; }
    return out;
  }

  async readText(name: string): Promise<string | undefined> {
    const b = await this.read(name);
    return b ? utf8.decode(b) : undefined;
  }

  /** 以数据流方式读出条目，内存占用恒定（适合视频等大文件） */
  async *stream(entry: ZipEntry): AsyncGenerator<Uint8Array> {
    const start = await this.dataOffset(entry);
    const end = start + entry.compressedSize;
    if (entry.method === 0) {
      for (let o = start; o < end; o += CHUNK) yield await this.src.read(o, Math.min(CHUNK, end - o));
      return;
    }
    if (entry.method !== 8) throw new Error(`不支持的压缩方式 ${entry.method}: ${entry.name}`);
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    const src = this.src;
    const pump = (async () => {
      try {
        for (let o = start; o < end; o += CHUNK) {
          await writer.write(await src.read(o, Math.min(CHUNK, end - o)) as Uint8Array<ArrayBuffer>);
        }
        await writer.close();
      } catch (e) {
        await writer.abort(e).catch(() => {});
      }
    })();
    const reader = ds.readable.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        yield value;
      }
    } finally {
      reader.releaseLock();
      await pump;
    }
  }
}
