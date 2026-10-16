/**
 * CTF（Compact Table Format）还原成 TTF：MicroType Express 第一层压缩的逆过程（W3C MTX 规范第 5 节）。
 * CTF 的第一个数据块就是一个 TTF，只是 glyf 表换成了紧凑格式、loca 表被去掉，
 * cvt / hdmx / VDMX 也是压缩格式。这里只还原排版和显示需要的部分：
 *   - glyf + loca 按字形重建（坐标是"三元组"编码，和 WOFF2 相同）；
 *   - 微调指令（hinting）不还原：字形里的指令长度写 0，cvt/fpgm/prep/hdmx/VDMX 等表去掉。
 *     产物里的字体子集本来也不带微调，浏览器显示不受影响。
 */
import { be16, finishTables, readSfnt, Writer, writeSfnt, type SfntTables } from './sfnt';

/** 不保留的表：微调相关、压缩格式没还原的、签名（字体已经改过） */
const DROP = new Set(['loca', 'glyf', 'cvt ', 'fpgm', 'prep', 'hdmx', 'VDMX', 'LTSH', 'DSIG']);

class Reader {
  pos = 0;
  constructor(private b: Uint8Array) {}
  u8() {
    if (this.pos >= this.b.length) throw new Error('CTF 字形数据提前结束');
    return this.b[this.pos++];
  }
  u16() { return (this.u8() << 8) | this.u8(); }
  s16() { const v = this.u16(); return v & 0x8000 ? v - 0x10000 : v; }
  /** 255USHORT：小数值一个字节 */
  u255() {
    const c = this.u8();
    if (c === 253) return this.u16();
    if (c === 255) return 253 + this.u8();
    if (c === 254) return 506 + this.u8();
    return c;
  }
}

/** 三元组编码的一个点：flag 低 7 位决定后面几个字节、各几位、加多少、正负（和 WOFF2 的 glyf 变换相同） */
function triplet(flag: number, r: Reader): [number, number] {
  const sign = (f: number, v: number) => (f & 1 ? v : -v);
  if (flag < 10) return [0, sign(flag, ((flag & 14) << 7) + r.u8())];
  if (flag < 20) return [sign(flag, (((flag - 10) & 14) << 7) + r.u8()), 0];
  if (flag < 84) {
    const b0 = flag - 20, b1 = r.u8();
    return [sign(flag, 1 + (b0 & 0x30) + (b1 >> 4)), sign(flag >> 1, 1 + ((b0 & 0x0c) << 2) + (b1 & 0x0f))];
  }
  if (flag < 120) {
    const b0 = flag - 84, x = r.u8(), y = r.u8();
    return [sign(flag, 1 + (Math.floor(b0 / 12) << 8) + x), sign(flag >> 1, 1 + (((b0 % 12) >> 2) << 8) + y)];
  }
  if (flag < 124) {
    const a = r.u8(), b = r.u8(), c = r.u8();
    return [sign(flag, (a << 4) + (b >> 4)), sign(flag >> 1, ((b & 0x0f) << 8) + c)];
  }
  const a = r.u16(), b = r.u16();
  return [sign(flag, a), sign(flag >> 1, b)];
}

/** 读错位时最多回头试几次 */
const MAX_RETRY = 16;

/** maxp 里的上限：字形数据读错位时（见 ctfToTtf）读出来的轮廓数、点数会超出，用来发现错位 */
interface Limits { contours: number; points: number; components: number; glyphs: number }

/** 简单字形：CTF -> TTF（不带指令） */
function simpleGlyph(r: Reader, contours: number, out: Writer, lim: Limits) {
  // 空字形（比如空格）只有一个 0，后面什么都没有
  if (contours === 0) return;
  let bbox: number[] | undefined;
  if (contours === 0x7fff) {
    contours = r.s16();
    bbox = [r.s16(), r.s16(), r.s16(), r.s16()];
  }
  if (contours > lim.contours) throw new Error('CTF 字形的轮廓数超出 maxp');
  // 第一个轮廓存终点下标，后面的存点数
  const ends: number[] = [];
  for (let i = 0; i < contours; i++) ends.push(i === 0 ? r.u255() : ends[i - 1] + r.u255());
  const n = contours ? ends[contours - 1] + 1 : 0;
  if (n > lim.points) throw new Error('CTF 字形的点数超出 maxp');
  const flags: number[] = [];
  for (let i = 0; i < n; i++) flags.push(r.u8());
  const dx: number[] = [], dy: number[] = [];
  let x = 0, y = 0, xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const [a, b] = triplet(flags[i] & 0x7f, r);
    dx.push(a); dy.push(b);
    x += a; y += b;
    xMin = Math.min(xMin, x); xMax = Math.max(xMax, x); yMin = Math.min(yMin, y); yMax = Math.max(yMax, y);
  }
  // 指令放在另外两个数据块里，这里只跳过计数
  r.u255(); r.u255();
  bbox ??= n ? [xMin, yMin, xMax, yMax] : [0, 0, 0, 0];
  out.u16(contours);
  for (const v of bbox) out.u16(v);
  for (const e of ends) out.u16(e);
  out.u16(0); // 指令长度
  // TTF 标志：bit0 在曲线上；坐标在 -255~255 之间用一个字节，为 0 时不写
  for (let i = 0; i < n; i++) {
    let f = flags[i] & 0x80 ? 0 : 1;
    if (dx[i] === 0) f |= 0x10; else if (Math.abs(dx[i]) < 256) f |= 0x02 | (dx[i] > 0 ? 0x10 : 0);
    if (dy[i] === 0) f |= 0x20; else if (Math.abs(dy[i]) < 256) f |= 0x04 | (dy[i] > 0 ? 0x20 : 0);
    out.u8(f);
  }
  for (const v of dx) if (v !== 0) { if (Math.abs(v) < 256) out.u8(Math.abs(v)); else out.u16(v); }
  for (const v of dy) if (v !== 0) { if (Math.abs(v) < 256) out.u8(Math.abs(v)); else out.u16(v); }
}

/**
 * 组合字形：部件记录和 TTF 相同，原样复制；最后一个部件带"有指令"标志时后面跟两个计数（跳过），指令长度写 0。
 * counts=false：标志在、计数却没写（见 ctfToTtf）。返回读没读计数
 */
function compositeGlyph(r: Reader, out: Writer, lim: Limits, counts: boolean): boolean {
  out.u16(0xffff);
  for (let i = 0; i < 4; i++) out.u16(r.s16());
  let flags: number, n = 0;
  do {
    flags = r.u16();
    // 去掉"带指令"标志：指令不还原
    out.u16(flags & ~0x100);
    const glyph = r.u16();
    if (glyph >= lim.glyphs || ++n > lim.components) throw new Error('CTF 组合字形的部件不对');
    out.u16(glyph);
    const argBytes = flags & 1 ? 4 : 2;
    const xform = flags & 8 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0;
    for (let i = 0; i < argBytes + xform; i++) out.u8(r.u8());
  } while (flags & 0x20);
  if (!(flags & 0x100) || !counts) return false;
  r.u255(); r.u255();
  return true;
}

/** 按顺序还原所有字形；noCounts 里的组合字形当成没写指令计数。出错时带上出错的字形和读了计数的组合字形 */
function glyphs(glyfIn: Uint8Array, lim: Limits, noCounts: Set<number>): { glyf: Uint8Array; loca: Uint8Array } | { error: Error; at: number; counted: number[] } {
  const r = new Reader(glyfIn);
  const glyf = new Writer(), loca = new Writer();
  const counted: number[] = [];
  for (let g = 0; g < lim.glyphs; g++) {
    loca.u32(glyf.len);
    try {
      const contours = r.s16();
      if (contours < 0) { if (compositeGlyph(r, glyf, lim, !noCounts.has(g))) counted.push(g); }
      else simpleGlyph(r, contours, glyf, lim);
    } catch (error) {
      return { error: error as Error, at: g, counted };
    }
    glyf.pad4();
  }
  loca.u32(glyf.len);
  return { glyf: glyf.done(), loca: loca.done() };
}

/**
 * CTF 第一个数据块 -> TTF 文件。
 * 实测（样本里 1 个嵌入字体）：组合字形最后一个部件带"有指令"标志、却没写两个指令计数（原字体里指令是空的），
 * 按规范读会错位，后面的字形读出几千个轮廓。读错时回到之前最近的、读了计数的组合字形，当成没写计数再读，
 * 读得更远就留下（最多试 MAX_RETRY 次）；PowerPoint 能用这个字体
 */
export function ctfToTtf(block: Uint8Array): Uint8Array {
  const tables = readSfnt(block);
  const head = tables.get('head')?.slice(), maxp = tables.get('maxp'), glyfIn = tables.get('glyf');
  if (!head || !maxp || !glyfIn) throw new Error('CTF 缺少 head/maxp/glyf 表');
  const numGlyphs = be16(maxp, 4);
  // maxp 1.0 才有上限（0.5 版只有字形数）；上限写成 0 的字体不查
  const max = (o: number, fallback: number) => (maxp.length >= 32 && be16(maxp, o) > 0 ? Math.max(be16(maxp, o), be16(maxp, o + 4)) : fallback);
  const lim: Limits = { glyphs: numGlyphs, points: max(6, 0xffff), contours: max(8, 0x7ffe), components: maxp.length >= 32 && be16(maxp, 28) > 0 ? be16(maxp, 28) : 0xffff };
  const noCounts = new Set<number>();
  // 先照规范读、不查上限（maxp 写得不准的字体照样能用）；读不下去才按上限找错位
  let res = glyphs(glyfIn, { glyphs: numGlyphs, points: 0xffff, contours: 0x7ffe, components: 0xffff }, noCounts);
  if ('error' in res) res = glyphs(glyfIn, lim, noCounts);
  for (let tries = 0; 'error' in res && tries < MAX_RETRY; tries++) {
    const fail: { error: Error; at: number; counted: number[] } = res;
    let better: ReturnType<typeof glyphs> | undefined;
    for (const g of fail.counted.slice(-4).reverse()) {
      noCounts.add(g);
      const next = glyphs(glyfIn, lim, noCounts);
      if (!('error' in next) || next.at > fail.at) { better = next; break; }
      noCounts.delete(g);
    }
    if (!better) break;
    res = better;
  }
  if ('error' in res) throw res.error;
  const { glyf, loca } = res;
  // loca 用长偏移
  head[50] = 0; head[51] = 1;
  const out: SfntTables = [['head', head], ['glyf', glyf], ['loca', loca]];
  for (const [tag, data] of tables) if (!DROP.has(tag) && tag !== 'head') out.push([tag, data.slice()]);
  return writeSfnt(finishTables(out));
}

