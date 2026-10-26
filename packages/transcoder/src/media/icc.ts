/**
 * CMYK 换 sRGB（Adobe 写法的四分量 JPEG 用）：PowerPoint 按 JPEG 里嵌入的 ICC 配置文件换算（感知意图，A2B0），没嵌入时按
 * Windows 自带的 SWOP 配置文件换算（实测，见 SPEC 第 7 节；表在 cmyk-default.ts）。浏览器、resvg 都不按这个来：
 * Chrome 按嵌入的配置文件、没嵌入时直接取反相乘，Firefox 一律取反相乘，resvg 不画。
 * 只认 CMYK 输入、Lab / XYZ 连接空间的 A2B0，表类型 lut8（mft1）、lut16（mft2）、lutAtoB（mAB）；认不了的返回 undefined
 * （调用方退回没嵌入时的换算）。
 * 插值和 lcms 一样：第一个通道（C）线性，后三个（M、Y、K）四面体插值；连接空间 Lab（D50）-> XYZ -> sRGB（Bradford 适应到 D50 的矩阵）。
 */

/** 一个像素：c、m、y、k 是油墨量（0 = 没有油墨，255 = 满），sRGB 写到 out[o]、out[o + 1]、out[o + 2] */
export type CmykConvert = (c: number, m: number, y: number, k: number, out: Uint8Array, o: number) => void;

/** 0~1 -> 0~1 的曲线 */
type Curve = (v: number) => number;

/** 四个输入的查找表：grid 是每个输入的格点数，clut 按第一个输入变化最慢排，每格 out 个 0~1 的值 */
export interface Lut4 {
  inCurves: (Curve | undefined)[];
  grid: number[];
  clut: Float32Array;
  out: number;
  /** 查表后的处理（输出曲线、矩阵等），in-place 改 v */
  post?: (v: Float64Array) => void;
}

const be16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const be32 = (b: Uint8Array, o: number) => (b[o] * 0x1000000) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
const s15 = (b: Uint8Array, o: number) => (be32(b, o) | 0) / 65536;
const sig = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

/** 表格曲线：n 个点均匀分布在 0~1，线性插值 */
function tableCurve(t: Float64Array): Curve {
  const n = t.length - 1;
  return (v) => {
    const x = Math.min(1, Math.max(0, v)) * n, i = Math.min(n - 1, Math.floor(x));
    return n <= 0 ? t[0] : t[i] + (t[i + 1] - t[i]) * (x - i);
  };
}

/** curv / para 类型的曲线（lutAtoB 里用），返回曲线和占的字节数（按 4 字节对齐） */
function readCurve(b: Uint8Array, o: number): [Curve | undefined, number] {
  const t = sig(b, o);
  if (t === 'curv') {
    const n = be32(b, o + 8);
    const size = 12 + n * 2;
    if (n === 0) return [undefined, size];
    if (n === 1) { const g = be16(b, o + 12) / 256; return [(v) => Math.pow(Math.max(0, v), g), size]; }
    const tab = new Float64Array(n);
    for (let i = 0; i < n; i++) tab[i] = be16(b, o + 12 + i * 2) / 65535;
    return [tableCurve(tab), size];
  }
  if (t === 'para') {
    const fn = be16(b, o + 8);
    const count = [1, 3, 4, 5, 7][fn];
    if (count === undefined) throw new Error('para');
    const p = Array.from({ length: count }, (_, i) => s15(b, o + 12 + i * 4));
    const [g, a = 1, bb = 0, c = 0, d = 0, e = 0, f = 0] = p;
    const pow = (x: number) => (x > 0 ? Math.pow(x, g) : 0);
    const curve: Curve = fn === 0 ? (x) => pow(x)
      : fn === 1 ? (x) => (x >= -bb / a ? pow(a * x + bb) : 0)
        : fn === 2 ? (x) => (x >= -bb / a ? pow(a * x + bb) + c : c)
          : fn === 3 ? (x) => (x >= d ? pow(a * x + bb) : c * x)
            : (x) => (x >= d ? pow(a * x + bb) + e : c * x + f);
    return [curve, 12 + count * 4];
  }
  throw new Error(`曲线类型 ${t}`);
}

function readCurves(b: Uint8Array, o: number, n: number): (Curve | undefined)[] {
  const out: (Curve | undefined)[] = [];
  for (let i = 0; i < n; i++) {
    const [c, size] = readCurve(b, o);
    out.push(c);
    o += (size + 3) & ~3;
  }
  return out;
}

/** lut8（mft1）、lut16（mft2）：输入曲线、格子、输出曲线；矩阵只在输入是 XYZ 时用，这里输入是 CMYK，不用 */
function readMft(b: Uint8Array, o: number, wide: boolean): Lut4 | undefined {
  const inN = b[o + 8], outN = b[o + 9], g = b[o + 10];
  if (inN !== 4 || outN !== 3 || g < 2) return undefined;
  const n = wide ? be16(b, o + 48) : 256, m = wide ? be16(b, o + 50) : 256;
  const size = wide ? 2 : 1, max = wide ? 65535 : 255;
  let p = o + (wide ? 52 : 48);
  const val = (q: number) => (wide ? be16(b, q) : b[q]) / max;
  const table = (count: number) => {
    const t = new Float64Array(count);
    for (let i = 0; i < count; i++, p += size) t[i] = val(p);
    return tableCurve(t);
  };
  const inCurves = Array.from({ length: 4 }, () => table(n));
  const total = g ** 4 * 3;
  if (p + total * size > b.length) return undefined;
  const clut = new Float32Array(total);
  for (let i = 0; i < total; i++, p += size) clut[i] = val(p);
  const outCurves = Array.from({ length: 3 }, () => table(m));
  return { inCurves, grid: [g, g, g, g], clut, out: 3, post: (v) => { for (let i = 0; i < 3; i++) v[i] = outCurves[i](v[i]); } };
}

/** lutAtoB（mAB）：A 曲线 -> 格子 -> M 曲线 -> 矩阵 -> B 曲线（偏移 0 的那一步没有） */
function readMab(b: Uint8Array, o: number): Lut4 | undefined {
  if (b[o + 8] !== 4 || b[o + 9] !== 3) return undefined;
  const [offB, offMat, offM, offClut, offA] = [12, 16, 20, 24, 28].map((k) => be32(b, o + k));
  if (!offClut) return undefined;
  const aCurves = offA ? readCurves(b, o + offA, 4) : [undefined, undefined, undefined, undefined];
  const c = o + offClut;
  const grid = [0, 1, 2, 3].map((i) => b[c + i]);
  const prec = b[c + 16];
  if (grid.some((g) => g < 2) || (prec !== 1 && prec !== 2)) return undefined;
  const total = grid.reduce((x, y) => x * y, 1) * 3;
  if (c + 20 + total * prec > b.length) return undefined;
  const clut = new Float32Array(total);
  for (let i = 0; i < total; i++) clut[i] = prec === 2 ? be16(b, c + 20 + i * 2) / 65535 : b[c + 20 + i] / 255;
  const mCurves = offM ? readCurves(b, o + offM, 3) : undefined;
  const mat = offMat ? Array.from({ length: 12 }, (_, i) => s15(b, o + offMat + i * 4)) : undefined;
  const bCurves = offB ? readCurves(b, o + offB, 3) : undefined;
  const t = new Float64Array(3);
  return {
    inCurves: aCurves, grid, clut, out: 3,
    post: (v) => {
      if (mCurves) for (let i = 0; i < 3; i++) v[i] = mCurves[i]?.(v[i]) ?? v[i];
      if (mat) {
        for (let i = 0; i < 3; i++) t[i] = mat[i * 3] * v[0] + mat[i * 3 + 1] * v[1] + mat[i * 3 + 2] * v[2] + mat[9 + i];
        v.set(t);
      }
      if (bCurves) for (let i = 0; i < 3; i++) v[i] = bCurves[i]?.(v[i]) ?? v[i];
    },
  };
}

/** sRGB 的伽马（线性 0~1 -> 0~255），按 8192 格查表 */
const GAMMA_N = 8192;
let gamma: Uint8Array | undefined;
function gammaTable(): Uint8Array {
  if (!gamma) {
    gamma = new Uint8Array(GAMMA_N + 1);
    for (let i = 0; i <= GAMMA_N; i++) {
      const v = i / GAMMA_N;
      gamma[i] = Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
    }
  }
  return gamma;
}

/** XYZ（D50）-> 线性 sRGB：Bradford 适应到 D50 的 sRGB 矩阵（Lindbloom） */
const M = [3.1338561, -1.6168667, -0.4906146, -0.9787684, 1.9161415, 0.033454, 0.0719453, -0.2289914, 1.4052427];

function xyzToRgb(x: number, y: number, z: number, out: Uint8Array, o: number, g: Uint8Array): void {
  for (let i = 0; i < 3; i++) {
    const v = M[i * 3] * x + M[i * 3 + 1] * y + M[i * 3 + 2] * z;
    out[o + i] = g[Math.round((v < 0 ? 0 : v > 1 ? 1 : v) * GAMMA_N)];
  }
}

/**
 * 查找表 -> 逐像素换算：每个输入通道 256 个值先算好格子位置；toRgb 把查出来的 0~1 值（连接空间的编码）换成 sRGB。
 * 和上一个像素一样时直接复制（大片同色很常见）
 */
export function lutConvert(lut: Lut4, toRgb: (v: Float64Array, out: Uint8Array, o: number) => void): CmykConvert {
  const { grid, clut, out: n } = lut;
  const idx = grid.map(() => new Int32Array(256)), frac = grid.map(() => new Float64Array(256));
  for (let ch = 0; ch < 4; ch++) {
    for (let v = 0; v < 256; v++) {
      const x = Math.min(1, Math.max(0, lut.inCurves[ch]?.(v / 255) ?? v / 255)) * (grid[ch] - 1);
      const i = Math.min(grid[ch] - 2, Math.floor(x));
      idx[ch][v] = i;
      frac[ch][v] = x - i;
    }
  }
  // 格子步长（最后一个通道变化最快）
  const s3 = n, s2 = grid[3] * s3, s1 = grid[2] * s2, s0 = grid[1] * s1;
  const v = new Float64Array(n), a = new Float64Array(n);
  let last = -1;
  const lastOut = new Uint8Array(3);
  /** 后三个通道在 base 处的四面体插值，加到 dst 上（权重 w） */
  const tetra = (base: number, rx: number, ry: number, rz: number, w: number, dst: Float64Array) => {
    let c1: number, c2: number, c3: number;
    for (let k = 0; k < n; k++) {
      const p000 = clut[base + k];
      const p100 = clut[base + s1 + k], p010 = clut[base + s2 + k], p001 = clut[base + s3 + k];
      const p110 = clut[base + s1 + s2 + k], p101 = clut[base + s1 + s3 + k], p011 = clut[base + s2 + s3 + k];
      const p111 = clut[base + s1 + s2 + s3 + k];
      if (rx >= ry && ry >= rz) { c1 = p100 - p000; c2 = p110 - p100; c3 = p111 - p110; }
      else if (rx >= rz && rz >= ry) { c1 = p100 - p000; c2 = p111 - p101; c3 = p101 - p100; }
      else if (rz >= rx && rx >= ry) { c1 = p101 - p001; c2 = p111 - p101; c3 = p001 - p000; }
      else if (ry >= rx && rx >= rz) { c1 = p110 - p010; c2 = p010 - p000; c3 = p111 - p110; }
      else if (ry >= rz && rz >= rx) { c1 = p111 - p011; c2 = p010 - p000; c3 = p011 - p010; }
      else { c1 = p111 - p011; c2 = p011 - p001; c3 = p001 - p000; }
      dst[k] += w * (p000 + c1 * rx + c2 * ry + c3 * rz);
    }
  };
  return (c, m, y, k, out, o) => {
    const key = (c << 24 | m << 16 | y << 8 | k) >>> 0;
    if (key === last) { out[o] = lastOut[0]; out[o + 1] = lastOut[1]; out[o + 2] = lastOut[2]; return; }
    const base = idx[0][c] * s0 + idx[1][m] * s1 + idx[2][y] * s2 + idx[3][k] * s3;
    const r0 = frac[0][c], rx = frac[1][m], ry = frac[2][y], rz = frac[3][k];
    a.fill(0);
    tetra(base, rx, ry, rz, 1 - r0, a);
    if (r0 > 0) tetra(base + s0, rx, ry, rz, r0, a);
    v.set(a);
    lut.post?.(v);
    toRgb(v, out, o);
    last = key;
    lastOut[0] = out[o]; lastOut[1] = out[o + 1]; lastOut[2] = out[o + 2];
  };
}

/** 嵌入的 ICC 配置文件 -> CMYK 换算；不是 CMYK 输入、连接空间不是 Lab / XYZ、没有能用的 A2B0 时 undefined */
export function iccCmyk(icc: Uint8Array): CmykConvert | undefined {
  try {
    if (icc.length < 132 || sig(icc, 16) !== 'CMYK') return undefined;
    const pcs = sig(icc, 20);
    if (pcs !== 'Lab ' && pcs !== 'XYZ ') return undefined;
    const count = be32(icc, 128);
    let tag = -1;
    for (let i = 0; i < count && 144 + i * 12 <= icc.length; i++) if (sig(icc, 132 + i * 12) === 'A2B0') tag = be32(icc, 136 + i * 12);
    if (tag < 0 || tag + 52 > icc.length) return undefined;
    const type = sig(icc, tag);
    const lut = type === 'mft2' ? readMft(icc, tag, true) : type === 'mft1' ? readMft(icc, tag, false) : type === 'mAB ' ? readMab(icc, tag) : undefined;
    if (!lut) return undefined;
    const g = gammaTable();
    // 连接空间的编码：lut16 是 v2 的旧编码（L 的 0xFF00 = 100），lut8 按 8 位，lutAtoB 是 v4 编码（0xFFFF = 100）
    const lScale = type === 'mft2' ? 65535 / 65280 * 100 : 100;
    const abScale = type === 'mft2' ? 65535 / 256 : 255;
    const xyzScale = type === 'mAB ' ? 65535 / 32768 : type === 'mft2' ? 65535 / 32768 : 1;
    const f = (t: number) => (t > 6 / 29 ? t * t * t : 3 * (6 / 29) ** 2 * (t - 4 / 29));
    const toRgb = pcs === 'Lab '
      ? (v: Float64Array, out: Uint8Array, o: number) => {
        const L = v[0] * lScale, A = v[1] * abScale - 128, B = v[2] * abScale - 128;
        const fy = (L + 16) / 116;
        xyzToRgb(0.9642 * f(fy + A / 500), f(fy), 0.8249 * f(fy - B / 200), out, o, g);
      }
      : (v: Float64Array, out: Uint8Array, o: number) => xyzToRgb(v[0] * xyzScale, v[1] * xyzScale, v[2] * xyzScale, out, o, g);
    return lutConvert(lut, toRgb);
  } catch {
    return undefined;
  }
}
