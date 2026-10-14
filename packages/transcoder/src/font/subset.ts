/**
 * TrueType 字体子集化（零依赖）：只保留用到的字，打包成 WOFF（压缩用内置的 CompressionStream）。
 * 只支持 glyf 轮廓的字体（.ttf / .ttc 里的 TrueType）；CFF 轮廓（多数 .otf）返回 undefined。
 */
import type { RandomAccessSource } from '../io/source';
import { buildCmap } from './cmap';
import { be16, be32, bes16, checksum, finishTables, tagOf, Writer, type SfntTables } from './sfnt';

interface Tables { [tag: string]: { offset: number; length: number } }

async function readDir(src: RandomAccessSource, faceOffset: number): Promise<Tables> {
  const h = await src.read(faceOffset, 12);
  const n = be16(h, 4);
  const d = await src.read(faceOffset + 12, n * 16);
  const t: Tables = {};
  for (let i = 0; i < n; i++) t[tagOf(d, i * 16)] = { offset: be32(d, i * 16 + 8), length: be32(d, i * 16 + 12) };
  return t;
}

/** 码点 -> 字形 的映射（只取用到的码点；cmap.ts） */
function mapCodepoints(cmap: Uint8Array, cps: number[]): Map<number, number> {
  const lookup = buildCmap(cmap);
  const out = new Map<number, number>();
  for (const cp of cps) {
    const gid = lookup(cp);
    if (gid) out.set(cp, gid);
  }
  return out;
}

function nameTable(family: string): Uint8Array {
  const recs: [number, string][] = [[1, family], [2, 'Regular'], [3, family], [4, family], [6, family.replace(/[^A-Za-z0-9-]/g, '')]];
  const strs = recs.map(([, s]) => { const b = new Uint8Array(s.length * 2); for (let i = 0; i < s.length; i++) { b[i * 2] = s.charCodeAt(i) >> 8; b[i * 2 + 1] = s.charCodeAt(i) & 255; } return b; });
  const w = new Writer();
  w.u16(0); w.u16(recs.length); w.u16(6 + recs.length * 12);
  let off = 0;
  recs.forEach(([id], i) => { w.u16(3); w.u16(1); w.u16(0x409); w.u16(id); w.u16(strs[i].length); w.u16(off); off += strs[i].length; });
  for (const s of strs) w.bytes(s);
  return w.done();
}

function cmapTable(map: [number, number][]): Uint8Array {
  // format 4（基本平面，每个码点一段）+ format 12（全部）
  const bmp = map.filter(([cp]) => cp <= 0xffff);
  const segs = [...bmp, [0xffff, 0] as [number, number]];
  const f4 = new Writer();
  const segX2 = segs.length * 2;
  let es = 0; while ((1 << (es + 1)) <= segs.length) es++;
  f4.u16(4); f4.u16(16 + segs.length * 8); f4.u16(0); f4.u16(segX2);
  f4.u16(2 << es); f4.u16(es); f4.u16(segX2 - (2 << es));
  for (const [cp] of segs) f4.u16(cp);
  f4.u16(0);
  for (const [cp] of segs) f4.u16(cp);
  for (const [cp, gid] of segs) f4.u16(cp === 0xffff && gid === 0 ? 1 : (gid - cp) & 0xffff);
  for (let i = 0; i < segs.length; i++) f4.u16(0);
  const a = f4.done();
  const f12 = new Writer();
  f12.u16(12); f12.u16(0); f12.u32(16 + map.length * 12); f12.u32(0); f12.u32(map.length);
  for (const [cp, gid] of map) { f12.u32(cp); f12.u32(cp); f12.u32(gid); }
  const b = f12.done();
  const w = new Writer();
  w.u16(0); w.u16(2);
  w.u16(3); w.u16(1); w.u32(4 + 16);
  w.u16(3); w.u16(10); w.u32(4 + 16 + a.length);
  w.bytes(a); w.bytes(b);
  return w.done();
}

/**
 * 生成子集。family 是嵌入后使用的字体名（用唯一别名，避免和观看端本机字体混淆）。
 * 返回 WOFF 字节；不支持的字体返回 undefined。
 */
export async function subsetFont(src: RandomAccessSource, faceOffset: number, codepoints: Iterable<number>, family: string): Promise<Uint8Array | undefined> {
  const t = await readDir(src, faceOffset);
  if (!t.glyf || !t.loca || !t.head || !t.hhea || !t.hmtx || !t.maxp || !t.cmap) return undefined;
  const get = (tag: string) => src.read(t[tag].offset, t[tag].length);
  const head = (await get('head')).slice();
  const hhea = (await get('hhea')).slice();
  const maxp = (await get('maxp')).slice();
  const loca = await get('loca');
  const hmtx = await get('hmtx');
  const cmap = await get('cmap');
  const longLoca = bes16(head, 50) === 1;
  const numGlyphs = be16(maxp, 4);
  const numHM = be16(hhea, 34);
  const locaAt = (g: number) => (longLoca ? be32(loca, g * 4) : be16(loca, g * 2) * 2);

  const cps = [...new Set(codepoints)].sort((a, b) => a - b);
  const cpMap = mapCodepoints(cmap, cps);
  // 需要的字形：.notdef + 用到的字 + 组合字形引用的部件
  const need = new Set<number>([0, ...cpMap.values()]);
  const glyphData = new Map<number, Uint8Array>();
  const queue = [...need];
  while (queue.length) {
    const g = queue.pop()!;
    if (g >= numGlyphs) continue;
    const start = locaAt(g), end = locaAt(g + 1);
    const data = end > start ? (await src.read(t.glyf.offset + start, end - start)).slice() : new Uint8Array(0);
    glyphData.set(g, data);
    if (data.length >= 10 && bes16(data, 0) < 0) {
      let p = 10;
      for (;;) {
        const flags = be16(data, p), comp = be16(data, p + 2);
        if (!need.has(comp)) { need.add(comp); queue.push(comp); }
        p += 4 + (flags & 1 ? 4 : 2);
        if (flags & 8) p += 2; else if (flags & 0x40) p += 4; else if (flags & 0x80) p += 8;
        if (!(flags & 0x20)) break;
      }
    }
  }
  const order = [...need].filter((g) => g < numGlyphs).sort((a, b) => a - b);
  const newId = new Map(order.map((g, i) => [g, i]));

  // glyf + loca（组合字形里的部件编号要改成新编号）
  const glyf = new Writer();
  const newLoca = new Writer();
  for (const g of order) {
    newLoca.u32(glyf.len);
    const data = glyphData.get(g) ?? new Uint8Array(0);
    if (data.length >= 10 && bes16(data, 0) < 0) {
      let p = 10;
      for (;;) {
        const flags = be16(data, p), comp = be16(data, p + 2);
        const nid = newId.get(comp) ?? 0;
        data[p + 2] = nid >> 8; data[p + 3] = nid & 255;
        p += 4 + (flags & 1 ? 4 : 2);
        if (flags & 8) p += 2; else if (flags & 0x40) p += 4; else if (flags & 0x80) p += 8;
        if (!(flags & 0x20)) break;
      }
    }
    glyf.bytes(data);
    glyf.pad4();
  }
  newLoca.u32(glyf.len);

  const newHmtx = new Writer();
  for (const g of order) {
    const adv = be16(hmtx, Math.min(g, numHM - 1) * 4);
    const lsb = g < numHM ? be16(hmtx, g * 4 + 2) : be16(hmtx, numHM * 4 + (g - numHM) * 2);
    newHmtx.u16(adv); newHmtx.u16(lsb);
  }

  head[50] = 0; head[51] = 1;                     // indexToLocFormat = 1（长偏移）
  hhea[34] = order.length >> 8; hhea[35] = order.length & 255;
  maxp[4] = order.length >> 8; maxp[5] = order.length & 255;
  const post = new Writer();
  const oldPost = t.post ? await get('post') : undefined;
  post.u32(0x00030000);
  if (oldPost && oldPost.length >= 32) post.bytes(oldPost.subarray(4, 32)); else for (let i = 0; i < 28; i++) post.u8(0);

  const tables: SfntTables = [
    ['OS/2', t['OS/2'] ? await get('OS/2') : new Uint8Array(0)],
    ['cmap', cmapTable(cps.filter((cp) => cpMap.has(cp)).map((cp) => [cp, newId.get(cpMap.get(cp)!)!]))],
    ['glyf', glyf.done()],
    ['head', head],
    ['hhea', hhea],
    ['hmtx', newHmtx.done()],
    ['loca', newLoca.done()],
    ['maxp', maxp],
    ['name', nameTable(family)],
    ['post', post.done()],
  ];
  return woff(finishTables(tables));
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
  const w = new Writer();
  w.u32(0x774f4646); w.u32(0x00010000); w.u32(total); w.u16(tables.length); w.u16(0);
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
