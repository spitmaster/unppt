/**
 * LZCOMP 解压：MicroType Express（PowerPoint 嵌入字体用的压缩格式）的第二层压缩。
 * 按 W3C 公开规范《MicroType Express (MTX) Font Format》第 3 节和附录 C 自己实现：
 *   - LZ77 的变种：字面字节、"从 2/4/6 个字节前复制一个字节"、按 (长度, 距离) 复制一段；
 *   - 符号、长度、距离各用一棵自适应霍夫曼树编码；
 *   - 历史缓冲前面预置 7168 字节固定数据，开头的数据也能用复制；
 *   - 输出可能再经过一层游程编码（第一位标明）。
 */

class BitReader {
  private pos = 0;
  private cur = 0;
  private left = 0;
  constructor(private data: Uint8Array) {}

  /** 每个字节从高位读到低位 */
  bit(): number {
    if (this.left === 0) {
      if (this.pos >= this.data.length) throw new Error('LZCOMP 数据提前结束');
      this.cur = this.data[this.pos++];
      this.left = 8;
    }
    this.left--;
    return (this.cur >> this.left) & 1;
  }

  value(bits: number): number {
    let v = 0;
    for (let i = 0; i < bits; i++) v = v * 2 + this.bit();
    return v;
  }
}

const ROOT = 1;

/**
 * 自适应霍夫曼树：节点按权重从大到小排列（下标小的权重大），每读一个符号把它和祖先的权重加一，
 * 加之前和同权重里最靠前的节点交换，保持排列（兄弟性质）。
 */
class AdaptiveHuffman {
  private up: Int32Array;
  private left: Int32Array;
  private right: Int32Array;
  /** 叶子是符号值，内部节点是 -1 */
  private code: Int32Array;
  private weight: Int32Array;
  private index: Int32Array;

  constructor(range: number) {
    const n = 2 * range;
    this.up = new Int32Array(n);
    this.left = new Int32Array(n);
    this.right = new Int32Array(n);
    this.code = new Int32Array(n);
    this.weight = new Int32Array(n);
    this.index = new Int32Array(range);
    for (let i = 2; i < n; i++) { this.up[i] = i >> 1; this.weight[i] = 1; }
    for (let i = 1; i < range; i++) { this.left[i] = 2 * i; this.right[i] = 2 * i + 1; }
    for (let i = 0; i < range; i++) {
      this.code[i] = -1;
      this.code[range + i] = i;
      this.left[range + i] = this.right[range + i] = -1;
      this.index[i] = range + i;
    }
    // 初始是完全二叉树，子节点下标都比父节点大：倒着累加权重
    for (let i = range - 1; i >= ROOT; i--) this.weight[i] = this.weight[this.left[i]] + this.weight[this.right[i]];
    // 规范规定的初始偏好
    if (range > 256 && range < 512) {
      this.update(this.index[256]);
      this.update(this.index[257]);
      for (let i = 0; i < 12; i++) this.update(this.index[range - 3]); // DUP2
      for (let i = 0; i < 6; i++) this.update(this.index[range - 2]);  // DUP4
    } else {
      for (let k = 0; k < 2; k++) for (let i = 0; i < range; i++) this.update(this.index[i]);
    }
  }

  read(bits: BitReader): number {
    let a = ROOT;
    do a = bits.bit() ? this.right[a] : this.left[a];
    while (this.code[a] < 0);
    const symbol = this.code[a];
    this.update(a);
    return symbol;
  }

  private update(a: number) {
    const w = this.weight;
    while (a !== ROOT) {
      const wa = w[a];
      let b = a - 1;
      if (w[b] === wa) {
        do b--; while (w[b] === wa);
        b++;
        if (b > ROOT) { this.swap(a, b); a = b; }
      }
      w[a] = wa + 1;
      a = this.up[a];
    }
    w[ROOT]++;
  }

  /** 交换两个位置上的子树（父节点指针按位置不变） */
  private swap(a: number, b: number) {
    const { left, right, code, weight } = this;
    let t = left[a]; left[a] = left[b]; left[b] = t;
    t = right[a]; right[a] = right[b]; right[b] = t;
    t = code[a]; code[a] = code[b]; code[b] = t;
    t = weight[a]; weight[a] = weight[b]; weight[b] = t;
    this.relink(a);
    this.relink(b);
  }

  private relink(i: number) {
    if (this.code[i] < 0) { this.up[this.left[i]] = i; this.up[this.right[i]] = i; } else this.index[this.code[i]] = i;
  }
}

/** 预置在历史缓冲前面的固定数据：32×96 个 (k, j) 字节对，再加 0~255 每个字节重复 4 次 */
const PRELOAD = 2 * 32 * 96 + 4 * 256;

function preload(buf: Uint8Array) {
  let i = 0;
  for (let k = 0; k < 32; k++) for (let j = 0; j < 96; j++) { buf[i++] = k; buf[i++] = j; }
  for (let j = 0; j < 256; j++) { buf[i++] = j; buf[i++] = j; buf[i++] = j; buf[i++] = j; }
}

/** 解压一个 LZCOMP 数据块。version 是 MTX 头里的版本号（1 表示没有游程编码标志位） */
export function lzcompDecompress(data: Uint8Array, version: number): Uint8Array {
  const bits = new BitReader(data);
  const runLength = version !== 1 && bits.bit() === 1;
  const dist = new AdaptiveHuffman(8);
  const len = new AdaptiveHuffman(8);
  const outLen = bits.value(24);
  // 距离用几组 3 位表示：够覆盖整个输出
  let ranges = 1;
  while (2 ** (3 * ranges) < outLen) ranges++;
  const DUP2 = 256 + 8 * ranges, DUP4 = DUP2 + 1, DUP6 = DUP2 + 2;
  const sym = new AdaptiveHuffman(DUP6 + 1);

  const buf = new Uint8Array(PRELOAD + outLen);
  preload(buf);
  const end = PRELOAD + outLen;
  let pos = PRELOAD;
  while (pos < end) {
    const s = sym.read(bits);
    if (s < 256) buf[pos++] = s;
    else if (s === DUP2) { buf[pos] = buf[pos - 2]; pos++; }
    else if (s === DUP4) { buf[pos] = buf[pos - 4]; pos++; }
    else if (s === DUP6) { buf[pos] = buf[pos - 6]; pos++; }
    else {
      // 长度：每组 3 位，低 2 位是数值，最高位表示后面还有
      let chunk = (s - 256) % 8;
      const n = Math.floor((s - 256) / 8) + 1;
      let length = 0;
      for (;;) {
        length = length * 4 + (chunk & 3);
        if (!(chunk & 4)) break;
        chunk = len.read(bits);
      }
      length += 2;
      let distance = 0;
      for (let i = 0; i < n; i++) distance = distance * 8 + dist.read(bits);
      distance += 1;
      // 距离 512 以上时最短复制 3 个字节
      if (distance >= 512) length++;
      // 距离指到要复制的那段的末尾
      const start = pos - distance - length + 1;
      if (start < 0 || pos + length > end) throw new Error('LZCOMP 复制越界');
      for (let j = 0; j < length; j++) buf[pos + j] = buf[start + j];
      pos += length;
    }
  }
  const out = buf.subarray(PRELOAD);
  return runLength ? unRunLength(out) : out;
}

/** 游程编码：第一个字节是转义字节；转义+0 表示转义字节本身，转义+n+b 表示 n 个 b */
function unRunLength(data: Uint8Array): Uint8Array {
  if (!data.length) return data;
  const esc = data[0];
  let size = 0;
  for (let i = 1; i < data.length; i++) {
    if (data[i] !== esc) { size++; continue; }
    const n = data[i + 1] ?? 0;
    size += n === 0 ? 1 : n;
    i += n === 0 ? 1 : 2;
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (let i = 1; i < data.length; i++) {
    if (data[i] !== esc) { out[o++] = data[i]; continue; }
    const n = data[i + 1] ?? 0;
    if (n === 0) { out[o++] = esc; i += 1; } else { out.fill(data[i + 2] ?? 0, o, o + n); o += n; i += 2; }
  }
  return out;
}
