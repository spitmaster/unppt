/**
 * 字距调整（kerning）：读字体的 GPOS 表里 'kern' 特性的成对调整（PairPos 格式 1、2，含扩展查找），
 * 没有时读老式 kern 表（格式 0）。只取第一个字的横向前进量调整（XAdvance），单位是字体单位。
 */

const be16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const bes16 = (b: Uint8Array, o: number) => { const v = be16(b, o); return v & 0x8000 ? v - 0x10000 : v; };
const be32 = (b: Uint8Array, o: number) => (b[o] * 0x1000000) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);

export type KernFn = (left: number, right: number) => number;

/** 覆盖表：字形 -> 序号，不在表里返回 -1 */
function coverageIndex(t: Uint8Array, off: number, g: number): number {
  const fmt = be16(t, off);
  if (fmt === 1) {
    let lo = 0, hi = be16(t, off + 2) - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const v = be16(t, off + 4 + mid * 2);
      if (v < g) lo = mid + 1; else if (v > g) hi = mid - 1; else return mid;
    }
    return -1;
  }
  if (fmt === 2) {
    let lo = 0, hi = be16(t, off + 2) - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = off + 4 + mid * 6;
      const start = be16(t, r), end = be16(t, r + 2);
      if (g < start) hi = mid - 1; else if (g > end) lo = mid + 1; else return be16(t, r + 4) + g - start;
    }
  }
  return -1;
}

/** 类定义表：字形 -> 类，没定义的是 0 */
function classOf(t: Uint8Array, off: number, g: number): number {
  const fmt = be16(t, off);
  if (fmt === 1) {
    const start = be16(t, off + 2), count = be16(t, off + 4);
    return g >= start && g < start + count ? be16(t, off + 6 + (g - start) * 2) : 0;
  }
  if (fmt === 2) {
    let lo = 0, hi = be16(t, off + 2) - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = off + 4 + mid * 6;
      const start = be16(t, r), end = be16(t, r + 2);
      if (g < start) hi = mid - 1; else if (g > end) lo = mid + 1; else return be16(t, r + 4);
    }
  }
  return 0;
}

const bits = (v: number) => { let n = 0; for (let x = v & 0xff; x; x &= x - 1) n++; return n; };
/** ValueRecord 里 XAdvance 的位置（前面有 XPlacement / YPlacement 时往后挪） */
const xAdvOffset = (fmt: number) => ((fmt & 1) ? 2 : 0) + ((fmt & 2) ? 2 : 0);

/** 一个 PairPos 子表：命中返回调整量，没命中返回 undefined */
function pairPos(t: Uint8Array, off: number, g1: number, g2: number): number | undefined {
  const fmt = be16(t, off);
  const cov = coverageIndex(t, off + be16(t, off + 2), g1);
  if (cov < 0) return undefined;
  const vf1 = be16(t, off + 4), vf2 = be16(t, off + 6);
  const size1 = bits(vf1) * 2, size2 = bits(vf2) * 2;
  if (fmt === 1) {
    if (cov >= be16(t, off + 8)) return undefined;
    const set = off + be16(t, off + 10 + cov * 2);
    const rec = 2 + size1 + size2;
    let lo = 0, hi = be16(t, set) - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = set + 2 + mid * rec;
      const second = be16(t, r);
      if (second < g2) lo = mid + 1;
      else if (second > g2) hi = mid - 1;
      else return vf1 & 4 ? bes16(t, r + 2 + xAdvOffset(vf1)) : 0;
    }
    return undefined;
  }
  if (fmt === 2) {
    const c1 = classOf(t, off + be16(t, off + 8), g1);
    const c2 = classOf(t, off + be16(t, off + 10), g2);
    const n1 = be16(t, off + 12), n2 = be16(t, off + 14);
    if (c1 >= n1 || c2 >= n2) return undefined;
    const r = off + 16 + (c1 * n2 + c2) * (size1 + size2);
    return vf1 & 4 ? bes16(t, r + xAdvOffset(vf1)) : 0;
  }
  return undefined;
}

function fromGpos(t: Uint8Array): KernFn | undefined {
  const featList = be16(t, 6), lookupList = be16(t, 8);
  const indices = new Set<number>();
  const nFeat = be16(t, featList);
  for (let i = 0; i < nFeat; i++) {
    const r = featList + 2 + i * 6;
    if (String.fromCharCode(t[r], t[r + 1], t[r + 2], t[r + 3]) !== 'kern') continue;
    const f = featList + be16(t, r + 4);
    const n = be16(t, f + 2);
    for (let k = 0; k < n; k++) indices.add(be16(t, f + 4 + k * 2));
  }
  if (!indices.size) return undefined;
  // 每个查找的成对调整子表（扩展查找类型 9 展开成真正的子表位置）
  const lookups: number[][] = [];
  for (const li of [...indices].sort((a, b) => a - b)) {
    if (li >= be16(t, lookupList)) continue;
    const lk = lookupList + be16(t, lookupList + 2 + li * 2);
    const type = be16(t, lk);
    const subs: number[] = [];
    for (let s = 0; s < be16(t, lk + 4); s++) {
      let sub = lk + be16(t, lk + 6 + s * 2);
      if (type === 9) {
        if (be16(t, sub + 2) !== 2) continue;
        sub += be32(t, sub + 4);
      } else if (type !== 2) continue;
      subs.push(sub);
    }
    if (subs.length) lookups.push(subs);
  }
  if (!lookups.length) return undefined;
  return (g1, g2) => {
    let sum = 0;
    for (const subs of lookups) {
      for (const sub of subs) {
        const v = pairPos(t, sub, g1, g2);
        if (v !== undefined) { sum += v; break; }
      }
    }
    return sum;
  };
}

function fromKernTable(t: Uint8Array): KernFn | undefined {
  if (be16(t, 0) !== 0) return undefined;
  const pairs = new Map<number, number>();
  let p = 4;
  for (let i = 0; i < be16(t, 2) && p + 6 <= t.length; i++) {
    const len = be16(t, p + 2), coverage = be16(t, p + 4);
    // 只要格式 0 的横排字距
    if ((coverage >> 8) === 0 && (coverage & 1)) {
      const n = be16(t, p + 6);
      for (let k = 0; k < n; k++) {
        const r = p + 14 + k * 6;
        if (r + 6 > t.length) break;
        pairs.set(be16(t, r) * 65536 + be16(t, r + 2), bes16(t, r + 4));
      }
    }
    p += len || 6;
  }
  if (!pairs.size) return undefined;
  return (g1, g2) => pairs.get(g1 * 65536 + g2) ?? 0;
}

export function buildKerning(gpos: Uint8Array | undefined, kern: Uint8Array | undefined): KernFn | undefined {
  try {
    return (gpos && fromGpos(gpos)) || (kern && fromKernTable(kern)) || undefined;
  } catch {
    return undefined;
  }
}
