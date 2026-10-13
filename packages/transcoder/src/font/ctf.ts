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

/** 简单字形：CTF -> TTF（不带指令） */
function simpleGlyph(r: Reader, contours: number, out: Writer) {
  // 空字形（比如空格）只有一个 0，后面什么都没有
  if (contours === 0) return;
  let bbox: number[] | undefined;
  if (contours === 0x7fff) {
    contours = r.s16();
    bbox = [r.s16(), r.s16(), r.s16(), r.s16()];
  }
  // 第一个轮廓存终点下标，后面的存点数
  const ends: number[] = [];
  for (let i = 0; i < contours; i++) ends.push(i === 0 ? r.u255() : ends[i - 1] + r.u255());
  const n = contours ? ends[contours - 1] + 1 : 0;
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

/** 组合字形：部件记录和 TTF 相同，原样复制；带指令时跳过计数，指令长度写 0 */
function compositeGlyph(r: Reader, out: Writer) {
  out.u16(0xffff);
  for (let i = 0; i < 4; i++) out.u16(r.s16());
  let flags: number;
  do {
    flags = r.u16();
    // 去掉"带指令"标志：指令不还原
    out.u16(flags & ~0x100);
    out.u16(r.u16()); // 部件字形编号
    const argBytes = flags & 1 ? 4 : 2;
    const xform = flags & 8 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0;
    for (let i = 0; i < argBytes + xform; i++) out.u8(r.u8());
  } while (flags & 0x20);
  if (flags & 0x100) { r.u255(); r.u255(); }
}

/** CTF 第一个数据块 -> TTF 文件 */
export function ctfToTtf(block: Uint8Array): Uint8Array {
  const tables = readSfnt(block);
  const head = tables.get('head')?.slice(), maxp = tables.get('maxp'), glyfIn = tables.get('glyf');
  if (!head || !maxp || !glyfIn) throw new Error('CTF 缺少 head/maxp/glyf 表');
  const numGlyphs = be16(maxp, 4);
  const r = new Reader(glyfIn);
  const glyf = new Writer(), loca = new Writer();
  for (let g = 0; g < numGlyphs; g++) {
    loca.u32(glyf.len);
    const contours = r.s16();
    if (contours < 0) compositeGlyph(r, glyf);
    else simpleGlyph(r, contours, glyf);
    glyf.pad4();
  }
  loca.u32(glyf.len);
  // loca 用长偏移
  head[50] = 0; head[51] = 1;
  const out: SfntTables = [['head', head], ['glyf', glyf.done()], ['loca', loca.done()]];
  for (const [tag, data] of tables) if (!DROP.has(tag) && tag !== 'head') out.push([tag, data.slice()]);
  return writeSfnt(finishTables(out));
}

