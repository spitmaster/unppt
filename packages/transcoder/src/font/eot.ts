/**
 * PowerPoint 嵌入的字体（ppt/fonts/*.fntdata）：EOT（Embedded OpenType）外壳，
 * 里面的字体数据一般经过 MicroType Express 压缩（标志 0x4），可能还做了异或（标志 0x10000000）。
 * 还原成普通 TTF 后交给字体库，和用户提供的字体一样使用。
 */
import { ctfToTtf } from './ctf';
import { loadFontFile, type FontFace, type FontMetrics } from './font';
import { toSource } from '../io/source';
import { lzcompDecompress } from './lzcomp';
import { sortTableDirectory } from './sfnt';

const le16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const le32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000;

const COMPRESSED = 0x4;
const XOR = 0x10000000;

/** MTX 容器：版本(1) 复制上限(3) 第二块偏移(3) 第三块偏移(3)，然后三个数据块。字形指令在后两块里，不需要 */
function mtxToTtf(d: Uint8Array): Uint8Array {
  const off2 = (d[4] << 16) | (d[5] << 8) | d[6];
  if (d.length < 10 || off2 < 10 || off2 > d.length) throw new Error('MTX 头损坏');
  return ctfToTtf(lzcompDecompress(d.subarray(10, off2), d[0]));
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
    // 表目录可能没按规范排序（见 sortTableDirectory）
    ttf = sortTableDirectory(eotToTtf(bytes) ?? bytes);
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

/** 读不出来的字体：一个字都没有，排版时自然退回替代字体 */
const EMPTY: FontMetrics = {
  unitsPerEm: 1000, ascent: 0.92, descent: 0.24, lineGap: 0,
  advance: () => undefined, kern: () => 0, outline: async () => undefined,
};

/**
 * 嵌入字体的占位：先按演示文稿里登记的名字注册，第一次用到（量字宽）时才读出来解压。
 * 没用到的嵌入字体（比如整套主题字体）不花时间和内存。读不出来时调用 onFail，排版退回替代字体。
 */
export function lazyEmbeddedFont(read: () => Promise<Uint8Array | undefined>, typeface: string, bold: boolean, italic: boolean, onFail: () => void): FontFace {
  let loaded: Promise<FontMetrics> | undefined;
  const face: FontFace = {
    families: [typeface.toLowerCase().trim()], displayFamily: typeface, bold, italic, weight: bold ? 700 : 400,
    source: toSource(new Uint8Array(0)), offset: 0,
    load() {
      loaded ??= (async () => {
        const bytes = await read();
        const real = bytes ? (await loadEmbeddedFont(bytes, typeface, bold, italic))[0] : undefined;
        if (!real) { onFail(); return EMPTY; }
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
