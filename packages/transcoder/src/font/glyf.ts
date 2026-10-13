/**
 * TrueType 字形轮廓（glyf / loca 表）：按需读单个字形，组合字形展开成简单轮廓。
 * 艺术字变形要把文字变成可以弯曲的路径时用。只支持 TrueType 轮廓（CFF 轮廓的 .otf 没有 glyf 表）。
 */
import type { RandomAccessSource } from '../io/source';
import { be16, be32, bes16 } from './sfnt';

/** 轮廓上的点：单位 em，y 向上（字体坐标系），on=false 是二次曲线的控制点 */
export interface OutlinePoint { x: number; y: number; on: boolean; }
export type Contour = OutlinePoint[];

interface TableRec { offset: number; length: number; }

/** 组合字形最多展开几层（防止恶意文件循环引用） */
const MAX_DEPTH = 8;

export class GlyphOutlines {
  private loca?: Promise<Uint8Array>;
  private cache = new Map<number, Promise<Contour[]>>();

  constructor(
    private src: RandomAccessSource, private glyf: TableRec, private locaRec: TableRec,
    private longLoca: boolean, private upem: number, private numGlyphs: number,
  ) {}

  glyph(gid: number): Promise<Contour[]> {
    let p = this.cache.get(gid);
    if (!p) {
      p = this.load(gid, 0).catch(() => []);
      this.cache.set(gid, p);
    }
    return p;
  }

  private async load(gid: number, depth: number): Promise<Contour[]> {
    if (gid >= this.numGlyphs || depth > MAX_DEPTH) return [];
    this.loca ??= this.src.read(this.locaRec.offset, this.locaRec.length);
    const loca = await this.loca;
    const at = (g: number) => (this.longLoca ? be32(loca, g * 4) : be16(loca, g * 2) * 2);
    const start = at(gid), end = at(gid + 1);
    if (end <= start || end > this.glyf.length) return [];
    const d = await this.src.read(this.glyf.offset + start, end - start);
    const n = bes16(d, 0);
    return n >= 0 ? simple(d, n, this.upem) : this.composite(d, depth);
  }

  private async composite(d: Uint8Array, depth: number): Promise<Contour[]> {
    const out: Contour[] = [];
    let p = 10;
    for (;;) {
      const flags = be16(d, p), comp = be16(d, p + 2);
      p += 4;
      let dx: number, dy: number;
      if (flags & 1) { dx = bes16(d, p); dy = bes16(d, p + 2); p += 4; } else { dx = (d[p] << 24) >> 24; dy = (d[p + 1] << 24) >> 24; p += 2; }
      // 参数不是位移而是对齐点编号时（很少见）按不偏移处理
      if (!(flags & 2)) { dx = 0; dy = 0; }
      const f2 = (o: number) => bes16(d, o) / 16384;
      let a = 1, b = 0, c = 0, e = 1;
      if (flags & 8) { a = e = f2(p); p += 2; } else if (flags & 0x40) { a = f2(p); e = f2(p + 2); p += 4; } else if (flags & 0x80) { a = f2(p); b = f2(p + 2); c = f2(p + 4); e = f2(p + 6); p += 8; }
      const ox = dx / this.upem, oy = dy / this.upem;
      for (const contour of await this.load(comp, depth + 1)) {
        out.push(contour.map((q) => ({ x: a * q.x + c * q.y + ox, y: b * q.x + e * q.y + oy, on: q.on })));
      }
      if (!(flags & 0x20)) break;
    }
    return out;
  }
}

function simple(d: Uint8Array, contours: number, upem: number): Contour[] {
  if (!contours) return [];
  const ends: number[] = [];
  for (let i = 0; i < contours; i++) ends.push(be16(d, 10 + i * 2));
  const n = ends[contours - 1] + 1;
  let p = 10 + contours * 2;
  p += 2 + be16(d, p); // 跳过指令
  const flags = new Uint8Array(n);
  for (let i = 0; i < n;) {
    const f = d[p++];
    flags[i++] = f;
    if (f & 8) { let r = d[p++]; while (r-- > 0 && i < n) flags[i++] = f; }
  }
  const coords = (short: number, same: number) => {
    const out = new Float64Array(n);
    let v = 0;
    for (let i = 0; i < n; i++) {
      const f = flags[i];
      if (f & short) { const b = d[p++]; v += f & same ? b : -b; } else if (!(f & same)) { v += bes16(d, p); p += 2; }
      out[i] = v;
    }
    return out;
  };
  const xs = coords(2, 16), ys = coords(4, 32);
  const out: Contour[] = [];
  let s = 0;
  for (const e of ends) {
    const c: Contour = [];
    for (let i = s; i <= e && i < n; i++) c.push({ x: xs[i] / upem, y: ys[i] / upem, on: (flags[i] & 1) !== 0 });
    if (c.length) out.push(c);
    s = e + 1;
  }
  return out;
}
