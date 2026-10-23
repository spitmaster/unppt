/**
 * 字体子集化：交给 HarfBuzz 的 hb-subset（harfbuzzjs 发布的 harfbuzz-subset.wasm，MIT；Chrome、Android、LibreOffice 都用 HarfBuzz），
 * TrueType 和 CFF（.otf）轮廓都支持。只保留用到的字，结果打包成 WOFF（每个表 zlib 压缩，用内置的 CompressionStream）。
 * WASM 在构建时直接打进 JS（esbuild 的 binary loader），不需要调用方另外提供。
 * 保留字体微调（hinting）和 gasp、hdmx、VDMX 等渲染表：实测嵌入后的显示和直接用系统字体逐像素一致（6 个文字用例 8 页里 7 页一致；
 * 以前自研的子集化不带这些表，只有 1 页一致）。去掉字距和排版特性表：文字按排版算好的位置逐字放置，用不到它们。
 */
import hbWasm from 'harfbuzzjs/dist/harfbuzz-subset.wasm';
import type { RandomAccessSource } from '../io/source';
import { clearReservedGlyphFlags } from './glyf-flags';
import { be32, checksum, readSfnt, Writer, type SfntTables } from './sfnt';
import { withUnicodeCmap } from './symbol-cmap';

interface HbExports {
  memory: WebAssembly.Memory;
  malloc(n: number): number;
  free(p: number): void;
  hb_blob_create(data: number, length: number, mode: number, user: number, destroy: number): number;
  hb_blob_destroy(b: number): void;
  hb_blob_get_length(b: number): number;
  hb_blob_get_data(b: number, length: number): number;
  hb_face_create(blob: number, index: number): number;
  hb_face_destroy(f: number): void;
  hb_face_reference_blob(f: number): number;
  hb_set_add(s: number, v: number): void;
  hb_subset_input_create_or_fail(): number;
  hb_subset_input_destroy(i: number): void;
  hb_subset_input_unicode_set(i: number): number;
  hb_subset_input_set(i: number, which: number): number;
  hb_subset_input_set_flags(i: number, flags: number): void;
  hb_subset_or_fail(face: number, input: number): number;
}

const HB_MEMORY_MODE_WRITABLE = 2;
const HB_SUBSET_SETS_DROP_TABLE_TAG = 3;
// 保留 .notdef 的轮廓；不按排版特性扩充字形（下面把排版特性表都去掉了）
const FLAGS = 0x40 | 0x200;
const DROP = ['GSUB', 'GPOS', 'GDEF', 'BASE', 'JSTF', 'MATH', 'kern', 'DSIG'];

let instance: Promise<HbExports> | undefined;
function hb(): Promise<HbExports> {
  instance ??= WebAssembly.instantiate(hbWasm as Uint8Array<ArrayBuffer>).then((r) => r.instance.exports as unknown as HbExports);
  return instance;
}

const tagNum = (t: string) => ((t.charCodeAt(0) << 24) | (t.charCodeAt(1) << 16) | (t.charCodeAt(2) << 8) | t.charCodeAt(3)) >>> 0;

/** 字体集合（.ttc）里，faceOffset 处的字体是第几个；普通字体是 0 */
function faceIndex(bytes: Uint8Array, faceOffset: number): number {
  if (faceOffset === 0 || be32(bytes, 0) !== 0x74746366) return 0;  // 'ttcf'
  const n = be32(bytes, 8);
  for (let i = 0; i < n; i++) if (be32(bytes, 12 + i * 4) === faceOffset) return i;
  return 0;
}

/**
 * 只保留 codepoints 用到的字，返回 WOFF 字节；字体解不开或子集化失败返回 undefined。
 * family 是嵌入后用的别名：浏览器按 @font-face 声明的名字找字体，不看字体内部的名字，所以不必改写 name 表。
 */
export async function subsetFont(src: RandomAccessSource, faceOffset: number, codepoints: Iterable<number>, _family: string): Promise<Uint8Array | undefined> {
  let bytes = await src.read(0, src.size);
  const cps = [...codepoints];
  // 只有符号 cmap 的字体（Wingdings 等）先换成 Unicode cmap，否则子集里没有字形、没有 cmap（symbol-cmap.ts）
  const patched = withUnicodeCmap(bytes, faceOffset, cps);
  if (patched) { bytes = patched; faceOffset = 0; }
  const e = await hb();
  const ptr = e.malloc(bytes.length);
  if (!ptr) return undefined;
  new Uint8Array(e.memory.buffer).set(bytes, ptr);
  const blob = e.hb_blob_create(ptr, bytes.length, HB_MEMORY_MODE_WRITABLE, 0, 0);
  const face = e.hb_face_create(blob, faceIndex(bytes, faceOffset));
  e.hb_blob_destroy(blob);
  const input = e.hb_subset_input_create_or_fail();
  let out: Uint8Array | undefined;
  if (input) {
    const unicodes = e.hb_subset_input_unicode_set(input);
    for (const cp of cps) e.hb_set_add(unicodes, cp);
    const drop = e.hb_subset_input_set(input, HB_SUBSET_SETS_DROP_TABLE_TAG);
    for (const t of DROP) e.hb_set_add(drop, tagNum(t));
    e.hb_subset_input_set_flags(input, FLAGS);
    const sub = e.hb_subset_or_fail(face, input);
    e.hb_subset_input_destroy(input);
    if (sub) {
      const rb = e.hb_face_reference_blob(sub);
      const len = e.hb_blob_get_length(rb);
      const data = e.hb_blob_get_data(rb, 0);
      if (len && data) out = new Uint8Array(e.memory.buffer).slice(data, data + len);
      e.hb_blob_destroy(rb);
      e.hb_face_destroy(sub);
    }
  }
  e.hb_face_destroy(face);
  e.free(ptr);
  if (!out) return undefined;
  const tables = readSfnt(out);
  // 没有 cmap 的字体浏览器拒绝加载：当作子集化失败（调用方提示没有嵌入），不输出坏字体
  if (!tables.has('cmap')) return undefined;
  clearReservedGlyphFlags(tables);
  return woff([...tables].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate');
  const w = cs.writable.getWriter();
  void w.write(data as Uint8Array<ArrayBuffer>).then(() => w.close());
  const parts: Uint8Array[] = [];
  const r = cs.readable.getReader();
  for (;;) { const { done, value } = await r.read(); if (done) break; parts.push(value); }
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** 打包成 WOFF 1.0（每个表单独 zlib 压缩） */
async function woff(tables: SfntTables): Promise<Uint8Array> {
  const comp = await Promise.all(tables.map(async ([, d]) => { const c = await deflate(d); return c.length < d.length ? c : d; }));
  let total = 44 + tables.length * 20;
  for (const c of comp) total += Math.ceil(c.length / 4) * 4;
  let sfntSize = 12 + tables.length * 16;
  for (const [, d] of tables) sfntSize += Math.ceil(d.length / 4) * 4;
  const cff = tables.some(([t]) => t === 'CFF ' || t === 'CFF2');
  const w = new Writer();
  w.u32(0x774f4646); w.u32(cff ? 0x4f54544f : 0x00010000); w.u32(total); w.u16(tables.length); w.u16(0);
  w.u32(sfntSize); w.u16(1); w.u16(0); w.u32(0); w.u32(0); w.u32(0); w.u32(0); w.u32(0);
  let off = 44 + tables.length * 20;
  tables.forEach(([tg, d], i) => {
    for (let k = 0; k < 4; k++) w.u8(tg.charCodeAt(k));
    w.u32(off); w.u32(comp[i].length); w.u32(d.length); w.u32(checksum(d));
    off += Math.ceil(comp[i].length / 4) * 4;
  });
  for (const c of comp) { w.bytes(c); w.pad4(); }
  return w.done();
}
