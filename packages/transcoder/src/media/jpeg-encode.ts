/**
 * 基线 JPEG 编码（缩略图里的照片用，比 PNG 小得多）：YCbCr 4:4:4、标准量化表按质量缩放、标准哈夫曼表（JPEG 规范附录 K）。
 * 输入 8 位 RGB（每像素 3 字节）。
 */

const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
];
const Q_LUMA = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];
const Q_CHROMA = [
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
];
// 标准哈夫曼表：每个码长的个数（1~16）和符号
const DC_LUMA = { counts: [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0], symbols: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] };
const DC_CHROMA = { counts: [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], symbols: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] };
const AC_LUMA = {
  counts: [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d],
  symbols: [
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08,
    0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
    0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
    0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
    0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6,
    0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
    0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
  ],
};
const AC_CHROMA = {
  counts: [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77],
  symbols: [
    0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91,
    0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
    0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58,
    0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
    0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4,
    0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
    0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
  ],
};

interface Table { counts: number[]; symbols: number[] }
interface Codes { code: number[]; len: number[] }

/** 由码长个数生成规范哈夫曼码 */
function codesOf(t: Table): Codes {
  const code: number[] = [], len: number[] = [];
  let c = 0, k = 0;
  for (let l = 1; l <= 16; l++) {
    for (let i = 0; i < t.counts[l - 1]; i++) { code[t.symbols[k]] = c; len[t.symbols[k]] = l; c++; k++; }
    c <<= 1;
  }
  return { code, len };
}

/** 质量 1~100 -> 量化表（按 IJG 的缩放公式），按 zigzag 顺序 */
function quant(base: number[], quality: number): number[] {
  const q = Math.max(1, Math.min(100, quality));
  const s = q < 50 ? 5000 / q : 200 - q * 2;
  return ZIGZAG.map((i) => Math.max(1, Math.min(255, Math.floor((base[i] * s + 50) / 100))));
}

/** 8×8 DCT 的余弦表 */
const COS = Array.from({ length: 64 }, (_, k) => {
  const u = k >> 3, x = k & 7;
  return Math.cos(((2 * x + 1) * u * Math.PI) / 16) * (u === 0 ? Math.SQRT1_2 : 1);
});

function fdct(block: Float64Array, out: Float64Array) {
  const tmp = new Float64Array(64);
  for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++) {
    let s = 0;
    for (let x = 0; x < 8; x++) s += block[y * 8 + x] * COS[u * 8 + x];
    tmp[y * 8 + u] = s / 2;
  }
  for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) {
    let s = 0;
    for (let y = 0; y < 8; y++) s += tmp[y * 8 + u] * COS[v * 8 + y];
    out[v * 8 + u] = s / 2;
  }
}

class BitWriter {
  private bytes: number[] = [];
  private acc = 0;
  private n = 0;
  write(code: number, len: number) {
    for (let i = len - 1; i >= 0; i--) {
      this.acc = (this.acc << 1) | ((code >> i) & 1);
      if (++this.n === 8) {
        this.bytes.push(this.acc);
        if (this.acc === 0xff) this.bytes.push(0);
        this.acc = 0;
        this.n = 0;
      }
    }
  }
  flush(): number[] {
    if (this.n) this.write((1 << (8 - this.n)) - 1, 8 - this.n);
    return this.bytes;
  }
}

/** 数值的位数和 JPEG 的附加位写法 */
function category(v: number): [number, number] {
  const a = Math.abs(v);
  let n = 0;
  while (a >> n) n++;
  return [n, v < 0 ? v + (1 << n) - 1 : v];
}

export function encodeJpeg(rgb: Uint8Array, width: number, height: number, quality = 75): Uint8Array {
  const qY = quant(Q_LUMA, quality), qC = quant(Q_CHROMA, quality);
  const dcY = codesOf(DC_LUMA), acY = codesOf(AC_LUMA), dcC = codesOf(DC_CHROMA), acC = codesOf(AC_CHROMA);
  const bw = new BitWriter();
  const prev = [0, 0, 0];
  const block = new Float64Array(64), coef = new Float64Array(64);
  const comps = [
    (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b - 128,
    (r: number, g: number, b: number) => -0.168736 * r - 0.331264 * g + 0.5 * b,
    (r: number, g: number, b: number) => 0.5 * r - 0.418688 * g - 0.081312 * b,
  ];
  for (let by = 0; by < height; by += 8) for (let bx = 0; bx < width; bx += 8) {
    for (let c = 0; c < 3; c++) {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        // 边上不满 8 个像素的块用最后一行、最后一列补齐
        const o = (Math.min(by + y, height - 1) * width + Math.min(bx + x, width - 1)) * 3;
        block[y * 8 + x] = comps[c](rgb[o], rgb[o + 1], rgb[o + 2]);
      }
      fdct(block, coef);
      const q = c ? qC : qY, dc = c ? dcC : dcY, ac = c ? acC : acY;
      const z = ZIGZAG.map((i, k) => Math.round(coef[i] / q[k]));
      const [n, bits] = category(z[0] - prev[c]);
      prev[c] = z[0];
      bw.write(dc.code[n], dc.len[n]);
      if (n) bw.write(bits, n);
      let run = 0;
      for (let k = 1; k < 64; k++) {
        if (!z[k]) { run++; continue; }
        while (run > 15) { bw.write(ac.code[0xf0], ac.len[0xf0]); run -= 16; }
        const [m, b] = category(z[k]);
        const sym = (run << 4) | m;
        bw.write(ac.code[sym], ac.len[sym]);
        bw.write(b, m);
        run = 0;
      }
      if (run) bw.write(ac.code[0], ac.len[0]);
    }
  }
  const data = bw.flush();
  const out: number[] = [0xff, 0xd8];
  const seg = (marker: number, body: number[]) => out.push(0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body);
  seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  seg(0xdb, [0, ...qY, 1, ...qC]);
  seg(0xc0, [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]);
  seg(0xc4, [0x00, ...DC_LUMA.counts, ...DC_LUMA.symbols, 0x10, ...AC_LUMA.counts, ...AC_LUMA.symbols,
    0x01, ...DC_CHROMA.counts, ...DC_CHROMA.symbols, 0x11, ...AC_CHROMA.counts, ...AC_CHROMA.symbols]);
  seg(0xda, [3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]);
  const bytes = new Uint8Array(out.length + data.length + 2);
  bytes.set(out);
  bytes.set(data, out.length);
  bytes.set([0xff, 0xd9], out.length + data.length);
  return bytes;
}
