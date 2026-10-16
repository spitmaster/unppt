/**
 * 只读 zip：目录解析交给 zip.js（@zip.js/zip.js，BSD-3，周下载量六百多万，对各种不规范的 zip 有专门处理），
 * 解压用内置的 DecompressionStream（不开 Web Worker、不加载 zip.js 自带的 WASM）。
 * 按位置读取（RandomAccessSource），不把整个文件读进内存；支持 ZIP64。
 */
import { ZipReader as ZipJsReader, type Entry, type FileEntry } from '@zip.js/zip.js/lib/zip-core-reader.js';
import type { RandomAccessSource } from './source';

const OPTIONS = { useWebWorkers: false, useCompressionStream: true, checkSignature: false };

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  /** 文件内容的 CRC32（目录里记录的，不用读文件） */
  crc: number;
}

const utf8 = new TextDecoder('utf-8');
const CHUNK = 1 << 20;

/** zip.js 的读取接口：按位置读 */
class SourceReader {
  size: number;
  constructor(private src: RandomAccessSource) { this.size = src.size; }
  init() {}
  readUint8Array(index: number, length: number): Promise<Uint8Array> { return this.src.read(index, length); }
  /** 按块读出一段（zip.js 解压条目时用；和它的 Reader 基类同样的行为） */
  createReadable({ offset = 0, size = this.size - offset, chunkSize = CHUNK }: { offset?: number; size?: number; chunkSize?: number } = {}): ReadableStream<Uint8Array> {
    let done = 0;
    return new ReadableStream({
      pull: async (c) => {
        const n = Math.min(chunkSize, size - done);
        if (n <= 0) { c.close(); return; }
        const data = await this.src.read(offset + done, n);
        done += data.length;
        c.enqueue(data);
        if (done >= size || !data.length) c.close();
      },
    });
  }
}

export class ZipReader {
  private entries = new Map<string, { info: ZipEntry; raw: FileEntry }>();
  private lowerNames = new Map<string, string>();

  private constructor() {}

  static async open(src: RandomAccessSource): Promise<ZipReader> {
    const z = new ZipReader();
    const reader = new ZipJsReader(new SourceReader(src) as never, OPTIONS);
    let list: Entry[];
    try {
      list = (await reader.getEntries()) as Entry[];
    } catch {
      const head = await src.read(0, Math.min(8, src.size));
      if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) {
        throw new Error('这是老格式的 .ppt 文件（或加密的 pptx），暂不支持，请用 PowerPoint 另存为 .pptx 后再转码');
      }
      throw new Error('不是有效的 pptx 文件（找不到 zip 目录）');
    }
    for (const e of list) {
      if (e.directory) continue;
      const name = e.filename.replace(/^\//, '');
      z.entries.set(name, { info: { name, method: e.compressionMethod, compressedSize: e.compressedSize, size: e.uncompressedSize, crc: e.signature ?? 0 }, raw: e as FileEntry });
      z.lowerNames.set(name.toLowerCase(), name);
    }
    return z;
  }

  /** 按名字查找条目（OOXML 里的部件名大小写不敏感） */
  entry(name: string): ZipEntry | undefined {
    return this.find(name)?.info;
  }

  private find(name: string) {
    const n = name.replace(/^\//, '');
    return this.entries.get(n) ?? this.entries.get(this.lowerNames.get(n.toLowerCase()) ?? '');
  }

  names(): string[] {
    return [...this.entries.keys()];
  }

  /** 读出整个条目（适合 XML 等小文件） */
  async read(name: string): Promise<Uint8Array | undefined> {
    const e = this.find(name);
    if (!e) return undefined;
    const parts: Uint8Array[] = [];
    let total = 0;
    for await (const c of this.stream(e.info)) { parts.push(c); total += c.length; }
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
    const e = this.find(entry.name);
    if (!e) throw new Error(`zip 条目不存在: ${entry.name}`);
    const ts = new TransformStream<Uint8Array, Uint8Array>();
    const done = e.raw.getData(ts.writable, OPTIONS);
    // 条目坏了（例如本地文件头找不到）时 zip.js 直接失败、不关闭数据流：读的一方要同时等它，把错误交给调用方，
    // 不然一直等下去，没人处理的失败还会让 Node 结束进程（样本里有这种文件，PowerPoint 能打开）
    const failed = done.then(() => new Promise<never>(() => {}));
    failed.catch(() => {});
    const reader = ts.readable.getReader();
    try {
      for (;;) {
        const { done: end, value } = await Promise.race([reader.read(), failed]);
        if (end) break;
        yield value;
      }
    } finally {
      reader.releaseLock();
      await done;
    }
  }
}
