/**
 * JPEG 解码（自研、零依赖）：基线和渐进式（哈夫曼编码）、任意采样比例、重启标记；灰度、YCbCr、Adobe 的 RGB / CMYK / YCCK。
 * 给"设置透明色"在原图上抠、整页图换掉 resvg 画不了的 CMYK 图片用，所以追求简单正确：反变换用浮点；色度 2×1、2×2、1×2 采样按三角滤波
 * 平滑放大（和 libjpeg 一样），其它比例按块复制。CMYK / YCCK 和 PowerPoint 一样按嵌入的 ICC 配置文件换成 sRGB，没嵌入时按 PowerPoint
 * 的默认换算（icc.ts、cmyk-default.ts）。
 * 不支持的（算术编码、无损、12 位）返回 undefined。
 */
import { defaultCmyk } from './cmyk-default';
import { iccCmyk, type CmykConvert } from './icc';

export interface RgbImage { width: number; height: number; data: Uint8Array }

/**
 * 像素数超过这个的不解（防止异常文件占满内存）；按 1/8 解码时每块只存一个系数，上限放宽 64 倍；
 * 按 1/2、1/4 解码时系数照存、输出小，放宽 4 倍
 */
const MAX_PIXELS = 16_000_000;

/** 之字形顺序 -> 8×8 块里的位置 */
const ZIGZAG = Int8Array.from([
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21,
  28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61,
  54, 47, 55, 62, 63,
]);

/** fast：前 FAST_BITS 位的速查表，每项是 (码长 << 8) | 符号，0 表示码长超过 FAST_BITS、要逐位找 */
interface Huffman { maxcode: Int32Array; valptr: Int32Array; mincode: Int32Array; values: Uint8Array; fast: Uint16Array }

const FAST_BITS = 9;

function buildHuffman(counts: Uint8Array, values: Uint8Array): Huffman {
  const maxcode = new Int32Array(18).fill(-1), valptr = new Int32Array(17), mincode = new Int32Array(17);
  let code = 0, k = 0;
  for (let len = 1; len <= 16; len++) {
    const n = counts[len - 1];
    valptr[len] = k;
    mincode[len] = code;
    code += n;
    k += n;
    maxcode[len] = n ? code - 1 : -1;
    code <<= 1;
  }
  maxcode[17] = 0x7fffffff;
  const fast = new Uint16Array(1 << FAST_BITS);
  code = 0; k = 0;
  for (let len = 1; len <= FAST_BITS; len++) {
    for (let i = 0; i < counts[len - 1]; i++, k++, code++) {
      const shift = FAST_BITS - len;
      for (let j = 0; j < 1 << shift; j++) fast[(code << shift) | j] = (len << 8) | values[k];
    }
    code <<= 1;
  }
  return { maxcode, valptr, mincode, values, fast };
}

interface Component {
  id: number; h: number; v: number; tq: number;
  blocksPerLine: number; blocksPerColumn: number;
  /** 按 MCU 补齐后的块数（交错扫描用） */
  bpl: number; bpc: number;
  coef: Int16Array;
  pred: number;
  dc?: Huffman; ac?: Huffman;
}

/** 熵编码数据的位读取：一次缓存多个字节，跳过 0xFF00 的填充字节，遇到标记时停止（之后读出的都是 0） */
class Bits {
  buf = 0; n = 0; marker = false;
  constructor(public b: Uint8Array, public pos: number) {}
  /** 缓存补到至少 25 位 */
  private fill() {
    while (this.n <= 24) {
      let x = 0;
      if (!this.marker && this.pos < this.b.length) {
        x = this.b[this.pos];
        if (x === 0xff) {
          const y = this.b[this.pos + 1];
          if (y === 0) this.pos += 2;
          else { this.marker = true; x = 0; }
        } else this.pos++;
      }
      this.buf = (this.buf << 8) | x;
      this.n += 8;
    }
  }
  bit(): number {
    if (this.n === 0) this.fill();
    this.n--;
    return (this.buf >>> this.n) & 1;
  }
  bits(k: number): number {
    if (!k) return 0;
    if (this.n < k) this.fill();
    this.n -= k;
    return (this.buf >>> this.n) & ((1 << k) - 1);
  }
  decode(t: Huffman): number {
    if (this.n < 16) this.fill();
    const e = t.fast[(this.buf >>> (this.n - FAST_BITS)) & ((1 << FAST_BITS) - 1)];
    if (e) { this.n -= e >> 8; return e & 0xff; }
    // 码长超过速查表：逐位找
    let code = 0;
    for (let len = 1; len <= 16; len++) {
      code = (code << 1) | this.bit();
      if (code <= t.maxcode[len]) return t.values[t.valptr[len] + code - t.mincode[len]];
    }
    return 0;
  }
  /** 重启标记：丢掉缓存里剩下的位，跳过 RSTn */
  restart(): void {
    this.n = 0;
    this.buf = 0;
    this.marker = false;
    while (this.pos + 1 < this.b.length && !(this.b[this.pos] === 0xff && this.b[this.pos + 1] >= 0xd0 && this.b[this.pos + 1] <= 0xd7)) this.pos++;
    this.pos += 2;
  }
}

const extend = (v: number, s: number) => (s && v < 1 << (s - 1) ? v - (1 << s) + 1 : v);

interface Scan { comps: Component[]; ss: number; se: number; ah: number; al: number }

/**
 * minSize：只要最长边不小于这个尺寸就够用时（缩略图、超大图缩小），按 1/8、1/4、1/2 里最小的够用的比例解码；都不够时全尺寸。
 * 1/8 每个 8×8 块只取平均值（DC 系数），省掉反向 DCT，快好几倍；每块只存 DC，内存是全尺寸的 1/64，渐进式文件的交流扫描整段跳过。
 * 1/4、1/2 用块内取平均的反变换（像全尺寸解出来再按格子缩小，见 idctMatrix）
 */
export function decodeJpeg(b: Uint8Array, minSize?: number): RgbImage | undefined {
  try {
    return decode(b, minSize);
  } catch {
    return undefined;
  }
}

function decode(b: Uint8Array, minSize?: number): RgbImage | undefined {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return undefined;
  const qt: Int32Array[] = [];
  const dcT: Huffman[] = [], acT: Huffman[] = [];
  let comps: Component[] = [];
  let width = 0, height = 0, progressive = false, restartInterval = 0, adobe = -1;
  /** APP2 里分段存的 ICC 配置文件：序号 -> 这一段 */
  const icc = new Map<number, Uint8Array>();
  let mcusPerLine = 0, mcusPerCol = 0, maxH = 1, maxV = 1;
  let eobrun = 0;
  // bs：每个块在输出里占几个像素（8 全尺寸，4、2 是 1/2、1/4，1 是 1/8）；按 1/8 解码时每块只存 DC（stride 1），否则存 64 个系数
  let bs = 8, eighth = false, stride = 64;
  const u16 = (o: number) => (b[o] << 8) | b[o + 1];
  let pos = 2;
  while (pos + 4 <= b.length) {
    if (b[pos] !== 0xff) { pos++; continue; }
    const m = b[pos + 1];
    if (m === 0xff || m === 0x00 || (m >= 0xd0 && m <= 0xd7)) { pos++; continue; }
    if (m === 0xd9) break;
    const len = u16(pos + 2);
    const seg = pos + 4, end = pos + 2 + len;
    if (end > b.length) return undefined;
    if (m === 0xdb) {
      // 量化表（8 位或 16 位）
      for (let o = seg; o < end;) {
        const pq = b[o] >> 4, tq = b[o] & 15;
        const t = new Int32Array(64);
        for (let k = 0; k < 64; k++) t[ZIGZAG[k]] = pq ? u16(o + 1 + 2 * k) : b[o + 1 + k];
        qt[tq] = t;
        o += 1 + 64 * (pq ? 2 : 1);
      }
    } else if (m === 0xc4) {
      for (let o = seg; o < end;) {
        const tc = b[o] >> 4, th = b[o] & 15;
        const counts = b.subarray(o + 1, o + 17);
        const total = counts.reduce((a, c) => a + c, 0);
        const t = buildHuffman(counts, b.slice(o + 17, o + 17 + total));
        (tc ? acT : dcT)[th] = t;
        o += 17 + total;
      }
    } else if (m === 0xc0 || m === 0xc1 || m === 0xc2) {
      if (b[seg] !== 8) return undefined;
      progressive = m === 0xc2;
      height = u16(seg + 1);
      width = u16(seg + 3);
      const n = b[seg + 5];
      if (minSize !== undefined) bs = [1, 2, 4].find((k) => Math.max(Math.ceil((width * k) / 8), Math.ceil((height * k) / 8)) >= minSize) ?? 8;
      // 太大、存不下全部系数的只能按 1/8
      if (bs > 1 && bs < 8 && width * height > MAX_PIXELS * 4) bs = 1;
      eighth = bs === 1;
      stride = eighth ? 1 : 64;
      if (!width || !height || width * height > MAX_PIXELS * (eighth ? 64 : bs < 8 ? 4 : 1) || (n !== 1 && n !== 3 && n !== 4)) return undefined;
      comps = [];
      for (let i = 0; i < n; i++) {
        const o = seg + 6 + i * 3;
        comps.push({ id: b[o], h: b[o + 1] >> 4 || 1, v: b[o + 1] & 15 || 1, tq: b[o + 2], blocksPerLine: 0, blocksPerColumn: 0, bpl: 0, bpc: 0, coef: new Int16Array(0), pred: 0 });
      }
      maxH = Math.max(...comps.map((c) => c.h));
      maxV = Math.max(...comps.map((c) => c.v));
      mcusPerLine = Math.ceil(width / (8 * maxH));
      mcusPerCol = Math.ceil(height / (8 * maxV));
      for (const c of comps) {
        c.blocksPerLine = Math.ceil(Math.ceil((width * c.h) / maxH) / 8);
        c.blocksPerColumn = Math.ceil(Math.ceil((height * c.v) / maxV) / 8);
        c.bpl = mcusPerLine * c.h;
        c.bpc = mcusPerCol * c.v;
        c.coef = new Int16Array(c.bpl * c.bpc * stride);
      }
    } else if (m >= 0xc3 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      // 无损、算术编码等：不支持
      return undefined;
    } else if (m === 0xdd) {
      restartInterval = u16(seg);
    } else if (m === 0xee) {
      // Adobe APP14：颜色变换（0 = RGB / CMYK，1 = YCbCr，2 = YCCK）
      if (len >= 12 && String.fromCharCode(...b.subarray(seg, seg + 5)) === 'Adobe') adobe = b[seg + 11];
    } else if (m === 0xe2) {
      // APP2 "ICC_PROFILE\0" + 序号 + 总段数 + 数据
      if (len > 16 && String.fromCharCode(...b.subarray(seg, seg + 12)) === 'ICC_PROFILE\0') icc.set(b[seg + 12], b.subarray(seg + 14, end));
    } else if (m === 0xda) {
      if (!comps.length) return undefined;
      const ns = b[seg];
      const sc: Component[] = [];
      for (let i = 0; i < ns; i++) {
        const c = comps.find((x) => x.id === b[seg + 1 + i * 2]);
        if (!c) return undefined;
        const t = b[seg + 2 + i * 2];
        c.dc = dcT[t >> 4];
        c.ac = acT[t & 15];
        sc.push(c);
      }
      const o = seg + 1 + ns * 2;
      const scan: Scan = { comps: sc, ss: b[o], se: b[o + 1], ah: b[o + 2] >> 4, al: b[o + 2] & 15 };
      if (eighth && progressive && scan.ss > 0) {
        // 按 1/8 解码用不到交流系数：整段跳到下一个标记（0xFF 后面不是 0x00 填充、也不是重启标记）
        let q = end;
        while (q + 1 < b.length && !(b[q] === 0xff && b[q + 1] !== 0 && (b[q + 1] < 0xd0 || b[q + 1] > 0xd7))) q++;
        pos = q;
        continue;
      }
      const bits = new Bits(b, end);
      eobrun = 0;
      for (const c of sc) c.pred = 0;
      const block = progressive ? progressiveBlock(scan, bits, () => eobrun, (v) => { eobrun = v; }) : baselineBlock(bits, stride === 64);
      const single = sc.length === 1;
      const total = single ? sc[0].blocksPerLine * sc[0].blocksPerColumn : mcusPerLine * mcusPerCol;
      for (let mcu = 0; mcu < total; mcu++) {
        if (restartInterval && mcu > 0 && mcu % restartInterval === 0) {
          bits.restart();
          eobrun = 0;
          for (const c of sc) c.pred = 0;
        }
        if (single) {
          const c = sc[0];
          const row = Math.floor(mcu / c.blocksPerLine), col = mcu % c.blocksPerLine;
          block(c, (row * c.bpl + col) * stride);
        } else {
          const mr = Math.floor(mcu / mcusPerLine), mc = mcu % mcusPerLine;
          for (const c of sc) {
            for (let v = 0; v < c.v; v++) for (let h = 0; h < c.h; h++) {
              block(c, ((mr * c.v + v) * c.bpl + mc * c.h + h) * stride);
            }
          }
        }
      }
      pos = bits.pos;
      continue;
    }
    pos = end;
  }
  if (!comps.length) return undefined;
  const cmyk = comps.length === 4 ? cmykConvert(icc) : undefined;
  return toRgb(comps, qt, Math.ceil((width * bs) / 8), Math.ceil((height * bs) / 8), maxH, maxV, adobe, bs, cmyk);
}

type BlockFn = (c: Component, off: number) => void;

/** ac：存交流系数（按 1/8 解码时只解析、不存） */
function baselineBlock(bits: Bits, ac: boolean): BlockFn {
  return (c, off) => {
    if (!c.dc || !c.ac) return;
    const t = bits.decode(c.dc);
    c.pred += t ? extend(bits.bits(t), t) : 0;
    c.coef[off] = c.pred;
    for (let k = 1; k < 64;) {
      const rs = bits.decode(c.ac);
      const r = rs >> 4, s = rs & 15;
      if (!s) {
        if (r !== 15) break;
        k += 16;
        continue;
      }
      k += r;
      if (k > 63) break;
      const v = extend(bits.bits(s), s);
      if (ac) c.coef[off + ZIGZAG[k]] = v;
      k++;
    }
  };
}

function progressiveBlock(scan: Scan, bits: Bits, getEob: () => number, setEob: (v: number) => void): BlockFn {
  const { ss, se, ah, al } = scan;
  if (ss === 0) {
    // 直流：第一遍是差分，之后每遍补一位
    return (c, off) => {
      if (ah === 0) {
        if (!c.dc) return;
        const t = bits.decode(c.dc);
        c.pred += t ? extend(bits.bits(t), t) : 0;
        c.coef[off] = c.pred * (1 << al);
      } else if (bits.bit()) c.coef[off] |= 1 << al;
    };
  }
  if (ah === 0) {
    // 交流第一遍：带 EOB 游程
    return (c, off) => {
      let eob = getEob();
      if (eob > 0) { setEob(eob - 1); return; }
      if (!c.ac) return;
      for (let k = ss; k <= se;) {
        const rs = bits.decode(c.ac);
        const r = rs >> 4, s = rs & 15;
        if (!s) {
          if (r < 15) {
            eob = (1 << r) - 1 + (r ? bits.bits(r) : 0);
            setEob(eob);
            break;
          }
          k += 16;
          continue;
        }
        k += r;
        if (k > 63) break;
        c.coef[off + ZIGZAG[k]] = extend(bits.bits(s), s) * (1 << al);
        k++;
      }
    };
  }
  // 交流细化：已经非零的系数每个补一位，新出现的系数是 ±1
  const p1 = 1 << al, m1 = -1 << al;
  return (c, off) => {
    let k = ss;
    let eob = getEob();
    const refine = (z: number) => {
      const v = c.coef[z];
      if (bits.bit() && (v & p1) === 0) c.coef[z] = v >= 0 ? v + p1 : v + m1;
    };
    if (eob === 0 && c.ac) {
      for (; k <= se; k++) {
        const rs = bits.decode(c.ac);
        let r = rs >> 4;
        const s = rs & 15;
        let val = 0;
        if (s) val = bits.bit() ? p1 : m1;
        else if (r !== 15) {
          eob = (1 << r) + (r ? bits.bits(r) : 0);
          break;
        }
        while (k <= se) {
          const z = off + ZIGZAG[k];
          if (c.coef[z] !== 0) refine(z);
          else if (--r < 0) break;
          k++;
        }
        if (val && k <= se) c.coef[off + ZIGZAG[k]] = val;
      }
    }
    if (eob > 0) {
      for (; k <= se; k++) {
        const z = off + ZIGZAG[k];
        if (c.coef[z] !== 0) refine(z);
      }
      eob--;
    }
    setEob(eob);
  };
}

/** 8×8 反余弦变换的系数表：COS[x * 8 + u] = C(u)·cos((2x + 1)uπ/16) / 2 */
const COS = (() => {
  const t = new Float64Array(64);
  for (let x = 0; x < 8; x++) for (let u = 0; u < 8; u++) t[x * 8 + u] = (u === 0 ? Math.SQRT1_2 : 1) * Math.cos(((2 * x + 1) * u * Math.PI) / 16) / 2;
  return t;
})();

/** 1/8 解码：每个块只用 DC 系数（反变换后整块的平均值 = DC × 量化值 / 8）；这时每块只存了 DC */
function dcPlane(c: Component, q: Int32Array): Uint8Array {
  const out = new Uint8Array(c.bpl * c.bpc);
  for (let i = 0; i < out.length; i++) {
    const p = Math.round((c.coef[i] * q[0]) / 8 + 128);
    out[i] = p < 0 ? 0 : p > 255 ? 255 : p;
  }
  return out;
}

/** 反变换矩阵（bs 个输出 × 8 个系数）：全尺寸是 COS；bs < 8 时是 COS 每 8/bs 行的平均——反变换后块内取平均，直接从系数算，计算量小几倍 */
const IDCT = new Map<number, Float64Array>();
function idctMatrix(bs: number): Float64Array {
  let m = IDCT.get(bs);
  if (!m) {
    const k = 8 / bs;
    m = new Float64Array(bs * 8);
    for (let x = 0; x < bs; x++) {
      for (let u = 0; u < 8; u++) {
        let s = 0;
        for (let d = 0; d < k; d++) s += COS[(x * k + d) * 8 + u];
        m[x * 8 + u] = s / k;
      }
    }
    IDCT.set(bs, m);
  }
  return m;
}

/** 反量化 + 反变换，得到每个分量的像素平面（按 MCU 补齐的大小）；bs < 8 时每块出 bs×bs 个像素（块内取平均） */
function plane(c: Component, q: Int32Array, bs: number): Uint8Array {
  const w = c.bpl * bs, out = new Uint8Array(w * c.bpc * bs);
  const m = idctMatrix(bs);
  const f = new Float64Array(64), tmp = new Float64Array(8 * bs);
  // 全是 0 的系数行跳过（照片里高频行大多是 0；加 0 不改变和，结果逐位一样）
  const rows = new Uint8Array(8);
  for (let by = 0; by < c.bpc; by++) {
    for (let bx = 0; bx < c.bpl; bx++) {
      const off = (by * c.bpl + bx) * 64;
      // 先按行（u -> x），再按列（v -> y）
      let last = -1;
      for (let v = 0; v < 8; v++) {
        let any = 0;
        for (let u = 0; u < 8; u++) {
          const k = v * 8 + u, co = c.coef[off + k];
          f[k] = co * q[k];
          any |= co;
        }
        rows[v] = any ? 1 : 0;
        if (!any) continue;
        last = v;
        for (let x = 0; x < bs; x++) {
          let s = 0;
          for (let u = 0; u < 8; u++) s += m[x * 8 + u] * f[v * 8 + u];
          tmp[v * bs + x] = s;
        }
      }
      for (let x = 0; x < bs; x++) {
        for (let y = 0; y < bs; y++) {
          let s = 0;
          for (let v = 0; v <= last; v++) if (rows[v]) s += m[y * 8 + v] * tmp[v * bs + x];
          const p = Math.round(s + 128);
          out[(by * bs + y) * w + bx * bs + x] = p < 0 ? 0 : p > 255 ? 255 : p;
        }
      }
    }
  }
  return out;
}

/** bs：每个块在输出里占几个像素（8 是全尺寸，4、2 是 1/2、1/4 解码，1 是 1/8 解码） */
/** 四分量 JPEG 的换算：嵌入的 ICC 配置文件认得就用它，否则用 PowerPoint 没嵌入时的默认换算 */
function cmykConvert(parts: Map<number, Uint8Array>): CmykConvert {
  if (parts.size) {
    const seqs = [...parts.keys()].sort((x, y) => x - y);
    const all = new Uint8Array(seqs.reduce((n, k) => n + parts.get(k)!.length, 0));
    let o = 0;
    for (const k of seqs) { all.set(parts.get(k)!, o); o += parts.get(k)!.length; }
    const conv = iccCmyk(all);
    if (conv) return conv;
  }
  return defaultCmyk();
}

function toRgb(comps: Component[], qt: Int32Array[], width: number, height: number, maxH: number, maxV: number, adobe: number, bs: number, cmyk?: CmykConvert): RgbImage | undefined {
  const planes = comps.map((c) => {
    const q = qt[c.tq];
    return q ? (bs === 1 ? dcPlane(c, q) : plane(c, q, bs)) : undefined;
  });
  if (planes.some((p) => !p)) return undefined;
  const data = new Uint8Array(width * height * 3);
  const n = comps.length;
  // 每个分量放大到全分辨率（宽度按 MCU 补齐，所有分量一样）
  const full = comps.map((c, k) => upsample(planes[k]!, c.bpl * bs, c.bpc * bs, maxH / c.h, maxV / c.v));
  const fw = comps[0].bpl * bs * (maxH / comps[0].h);
  const sample = (k: number, x: number, y: number) => full[k][y * fw + x];
  const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
  const ycc = (Y: number, cb: number, cr: number): [number, number, number] =>
    [clamp(Y + 1.402 * (cr - 128)), clamp(Y - 0.344136 * (cb - 128) - 0.714136 * (cr - 128)), clamp(Y + 1.772 * (cb - 128))];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 3;
      let r: number, g: number, bl: number;
      if (n === 4) {
        // 四分量：Adobe 的 CMYK 取反存储（255 = 没有油墨）；YCCK 的前三个分量是 255 − 取反存储的 C、M、Y 当成 RGB 算出的 YCbCr
        // （libjpeg 的 ycck_cmyk_convert：存储的 C = 255 − R），所以油墨量就是算出来的 R、G、B。没有 Adobe 标记的也按取反存储（和浏览器一样）
        let C = sample(0, x, y), M = sample(1, x, y), Y = sample(2, x, y);
        if (adobe === 2) [C, M, Y] = ycc(C, M, Y);
        else { C = 255 - C; M = 255 - M; Y = 255 - Y; }
        cmyk!(C, M, Y, 255 - sample(3, x, y), data, o);
        continue;
      }
      if (n === 1) {
        r = g = bl = sample(0, x, y);
      } else {
        const a = sample(0, x, y), b2 = sample(1, x, y), c2 = sample(2, x, y);
        // Adobe 标记写 0 表示分量本身就是 RGB
        [r, g, bl] = adobe === 0 ? [a, b2, c2] : ycc(a, b2, c2);
      }
      data[o] = r; data[o + 1] = g; data[o + 2] = bl;
    }
  }
  return { width, height, data };
}

/** 分量放大到全分辨率：2×1、2×2、1×2 用 libjpeg 的三角滤波（每个像素 3/4 自己 + 1/4 相邻），其它整数倍按块复制 */
function upsample(p: Uint8Array, w: number, h: number, fx: number, fy: number): Uint8Array {
  if (fx === 1 && fy === 1) return p;
  const W = w * fx, out = new Uint8Array(W * h * fy);
  const at = (x: number, y: number) => p[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  if (fx === 2 && fy === 1) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = 3 * at(x, y);
      out[y * W + 2 * x] = (c + at(x - 1, y) + 1) >> 2;
      out[y * W + 2 * x + 1] = (c + at(x + 1, y) + 2) >> 2;
    }
  } else if (fx === 1 && fy === 2) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = 3 * at(x, y);
      out[2 * y * W + x] = (c + at(x, y - 1) + 1) >> 2;
      out[(2 * y + 1) * W + x] = (c + at(x, y + 1) + 2) >> 2;
    }
  } else if (fx === 2 && fy === 2) {
    // 先竖向和较近的一行混合，再横向混合
    const col = (x: number, y: number, ny: number) => 3 * at(x, y) + at(x, ny);
    for (let y = 0; y < h; y++) {
      for (const [dy, ny] of [[0, y - 1], [1, y + 1]] as const) {
        const row = (2 * y + dy) * W;
        for (let x = 0; x < w; x++) {
          const c = 3 * col(x, y, ny);
          out[row + 2 * x] = (c + col(Math.max(0, x - 1), y, ny) + 8) >> 4;
          out[row + 2 * x + 1] = (c + col(Math.min(w - 1, x + 1), y, ny) + 7) >> 4;
        }
      }
    }
  } else {
    for (let y = 0; y < h * fy; y++) for (let x = 0; x < W; x++) out[y * W + x] = p[Math.floor(y / fy) * w + Math.floor(x / fx)];
  }
  return out;
}
