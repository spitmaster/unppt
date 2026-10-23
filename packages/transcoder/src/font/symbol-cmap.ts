/**
 * 符号字体子集化前的准备：Wingdings、Webdings、Symbol 等只有 (3, 0) 符号 cmap，hb-subset 只按 Unicode 子表保留字形、
 * 也不写 (3, 0) 子表，直接子集化得到的是没有 cmap、只剩 .notdef 的字体（浏览器拒绝加载）。
 * 这里先把用到的字（页面里的原文：'l'、'Ø'、U+F06C、• 等，课件的字符不改）按 cmap.ts 符号字体的规则找到字形，
 * 写成一张 (3, 1) format 4 子表换掉原来的 cmap，再交给 hb-subset。
 */
import { buildCmap } from './cmap';
import { be16, be32, finishTables, tagOf, writeSfnt, Writer, type SfntTables } from './sfnt';

/** faceOffset 处的字体只有符号 cmap 时，返回换成 Unicode cmap 的单个字体文件；不是符号字体时返回 undefined（照原样子集化） */
export function withUnicodeCmap(bytes: Uint8Array, faceOffset: number, codepoints: readonly number[]): Uint8Array | undefined {
  const tables = tablesAt(bytes, faceOffset);
  const cmap = tables.find(([t]) => t === 'cmap')?.[1];
  if (!cmap || !symbolOnly(cmap)) return undefined;
  const glyph = buildCmap(cmap);
  const pairs = [...new Set(codepoints)].filter((cp) => cp <= 0xfffe).sort((a, b) => a - b)
    .map((cp) => [cp, glyph(cp)] as const).filter(([, g]) => g > 0);
  if (!pairs.length) return undefined;
  // finishTables 会改写 head：表数据都复制一份，不动原来的字节
  return writeSfnt(finishTables(tables.map(([t, d]) => [t, t === 'cmap' ? format4(pairs) : d.slice()])));
}

/** 字体文件（或字体集合里 at 处的字体）的表：表目录里的偏移是从文件开头算的 */
function tablesAt(b: Uint8Array, at: number): SfntTables {
  const out: SfntTables = [];
  const n = be16(b, at + 4);
  for (let i = 0; i < n; i++) {
    const r = at + 12 + i * 16, off = be32(b, r + 8), len = be32(b, r + 12);
    if (off + len <= b.length) out.push([tagOf(b, r), b.subarray(off, off + len)]);
  }
  return out;
}

/** 没有 Unicode 子表、只有 (3, 0) 符号子表（和 cmap.ts buildCmap 的判断一致） */
function symbolOnly(t: Uint8Array): boolean {
  let symbol = false;
  for (let i = 0, n = be16(t, 2); i < n; i++) {
    const p = be16(t, 4 + i * 8), e = be16(t, 6 + i * 8), fmt = be16(t, be32(t, 8 + i * 8));
    if (((p === 3 && (e === 1 || e === 10)) || p === 0) && (fmt === 4 || fmt === 12)) return false;
    if (p === 3 && e === 0 && fmt === 4) symbol = true;
  }
  return symbol;
}

/** 只有一张 (3, 1) format 4 子表的 cmap：每个码点一段（用到的字不多），最后是规定的 0xFFFF 段 */
function format4(pairs: readonly (readonly [number, number])[]): Uint8Array {
  const segs = [...pairs.map(([cp, g]) => [cp, (g - cp) & 0xffff] as const), [0xffff, 1] as const];
  const n = segs.length;
  let es = 0; while ((1 << (es + 1)) <= n) es++;
  const w = new Writer();
  w.u16(0); w.u16(1); w.u16(3); w.u16(1); w.u32(12);
  w.u16(4); w.u16(16 + n * 8); w.u16(0);
  w.u16(n * 2); w.u16(2 << es); w.u16(es); w.u16(n * 2 - (2 << es));
  for (const [cp] of segs) w.u16(cp);
  w.u16(0);
  for (const [cp] of segs) w.u16(cp);
  for (const [, d] of segs) w.u16(d);
  for (let i = 0; i < n; i++) w.u16(0);
  return w.done();
}
