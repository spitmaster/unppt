/**
 * PowerPoint 嵌入的字体（ppt/fonts/*.fntdata）：EOT（Embedded OpenType）外壳，
 * 里面的字体数据一般经过 MicroType Express 压缩（标志 0x4），可能还做了异或（标志 0x10000000）。
 * 还原成普通 TTF 后交给字体库，和用户提供的字体一样使用。
 */
import { ctfToTtf } from './ctf';
import { loadFontFile, type FontFace } from './font';
import { lzcompDecompress } from './lzcomp';

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
