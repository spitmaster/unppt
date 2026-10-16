/**
 * PowerPoint 嵌入的字体（ppt/fonts/*.fntdata）：EOT（Embedded OpenType）外壳，
 * 里面的字体数据一般经过 MicroType Express 压缩（标志 0x4），可能还做了异或（标志 0x10000000）。
 * 还原成普通 TTF 后交给字体库，和用户提供的字体一样使用。
 */
import { ctfToTtf } from './ctf';
import { loadFontFile, type FontFace, type FontMetrics } from './font';
import { toSource } from '../io/source';
import { lzcompDecompress } from './lzcomp';

const le16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const le32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000;

const COMPRESSED = 0x4;
const XOR = 0x10000000;

/**
 * MTX 容器：版本(1) 复制上限(3) 第二块偏移(3) 第三块偏移(3)，然后三个数据块。字形指令在后两块里，不需要。
 * CFF 轮廓的字体（文件头 OTTO）没有 glyf 表，第一块解压出来就是字体本身（实测样本，没做 CTF 变换）
 */
function mtxToTtf(d: Uint8Array): Uint8Array {
  const off2 = (d[4] << 16) | (d[5] << 8) | d[6];
  if (d.length < 10 || off2 < 10 || off2 > d.length) throw new Error('MTX 头损坏');
  const raw = lzcompDecompress(d.subarray(10, off2), d[0]);
  return raw[0] === 0x4f && raw[1] === 0x54 && raw[2] === 0x54 && raw[3] === 0x4f ? raw : ctfToTtf(raw);
}

/** EOT -> TTF；不是 EOT 时返回 undefined */
export function eotToTtf(eot: Uint8Array): Uint8Array | undefined {
  if (eot.length < 36 || le16(eot, 34) !== 0x504c) return undefined;
  const size = Math.min(le32(eot, 0), eot.length), dataSize = le32(eot, 4), flags = le32(eot, 12);
  // 字体数据在 EOT 的最后
  const start = size - dataSize;
  if (start < 36) return undefined;
  const data = eot.slice(start, size);
  if (flags & XOR) for (let i = 0; i < data.length; i++) data[i] ^= 0x50;
  return flags & COMPRESSED ? mtxToTtf(data) : data;
}

/**
 * 读一个嵌入字体。typeface 是演示文稿里写的字体名（保证能按这个名字找到），
 * bold / italic 是它在演示文稿里登记的字形。读不了时返回空数组。
 */
export async function loadEmbeddedFont(bytes: Uint8Array, typeface: string, bold: boolean, italic: boolean): Promise<FontFace[]> {
  let ttf: Uint8Array | undefined;
  try {
    ttf = eotToTtf(bytes) ?? bytes;
  } catch {
    return [];
  }
  const faces = await loadFontFile(ttf);
  const name = typeface.toLowerCase().trim();
  for (const f of faces) {
    if (!f.families.includes(name)) f.families.push(name);
    f.bold = bold;
    f.italic = italic;
  }
  return faces;
}

/** PowerPoint 不用的嵌入字体（见 lazyEmbeddedFont）：返回原因；能用（或者看不出来）时返回 undefined */
function unusableReason(bytes: Uint8Array): string | undefined {
  let f: Uint8Array;
  try {
    f = eotToTtf(bytes) ?? bytes;
  } catch {
    return undefined;
  }
  if (f.length < 12) return undefined;
  if (f[0] === 0x4f && f[1] === 0x54 && f[2] === 0x54 && f[3] === 0x4f) return '嵌入的字体是 CFF 轮廓（.otf），PowerPoint 不用它，按缺字体处理';
  if (f[0] === 0x74 && f[1] === 0x74 && f[2] === 0x63 && f[3] === 0x66) return undefined;
  const n = (f[4] << 8) | f[5];
  const tag = (i: number) => String.fromCharCode(f[12 + i * 16], f[13 + i * 16], f[14 + i * 16], f[15 + i * 16]);
  for (let i = 1; i < n && 16 + i * 16 <= f.length; i++) {
    if (tag(i - 1) > tag(i)) return '嵌入的字体表目录没排序，PowerPoint 不用它，按缺字体处理';
  }
  return undefined;
}

/** 读不出来的字体：一个字都没有，排版时自然退回替代字体 */
const EMPTY: FontMetrics = {
  unitsPerEm: 1000, ascent: 0.92, descent: 0.24, lineGap: 0,
  advance: () => undefined, kern: () => 0, outline: async () => undefined,
};

/**
 * 嵌入字体的占位：先按演示文稿里登记的名字注册，第一次用到（量字宽）时才读出来解压。
 * 没用到的嵌入字体（比如整套主题字体）不花时间和内存。读不出来、或者是 PowerPoint 不用的字体时调用 onFail（带原因），
 * 标成 unusable，排版按缺字体处理。
 * PowerPoint 不用的：CFF 轮廓（.otf，文件头 OTTO；Office 只能嵌入 TrueType 轮廓，这种是别的工具嵌进去的）、表目录没按标签
 * 升序排的（OpenType 规范要求升序）。实测（样本）：87 个这样的嵌入字体（85 个目录倒序的 CFF 思源黑体等、2 个目录倒序的
 * TrueType 微软雅黑），参考图上 PowerPoint 都按缺字体替代；把目录重排后用上它们，和参考图反而差得更远。手工拼的 EOT 连
 * 目录正常的 TrueType 对照组 PowerPoint 都不认，没能用中性用例分开验证这两条。
 */
export function lazyEmbeddedFont(read: () => Promise<Uint8Array | undefined>, typeface: string, bold: boolean, italic: boolean, onFail: (reason?: string) => void): FontFace {
  let loaded: Promise<FontMetrics> | undefined;
  const face: FontFace = {
    families: [typeface.toLowerCase().trim()], displayFamily: typeface, bold, italic, weight: bold ? 700 : 400,
    source: toSource(new Uint8Array(0)), offset: 0,
    load() {
      loaded ??= (async () => {
        const bytes = await read();
        const reason = bytes ? unusableReason(bytes) : undefined;
        if (reason) { face.unusable = true; onFail(reason); return EMPTY; }
        const real = bytes ? (await loadEmbeddedFont(bytes, typeface, bold, italic))[0] : undefined;
        if (!real) { face.unusable = true; onFail(); return EMPTY; }
        // 子集化要用真正的字体数据
        face.source = real.source;
        face.offset = real.offset;
        face.displayFamily = real.displayFamily;
        return real.load();
      })();
      return loaded;
    },
  };
  return face;
}
