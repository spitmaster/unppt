/**
 * cmap（码点 -> 字形编号）：支持 format 4（基本平面）和 format 12（全部 Unicode）。
 * 没有 Unicode 子表的符号字体（Wingdings、Webdings、Symbol，只有 (3, 0) 子表，字形在 U+F020~F0FF）：
 * 0x20~0xFF 的字符按 Windows 的做法映射到 U+F000 + 字符，U+F0xx 本身也能查到（"插入符号"存的就是这些码点）。
 */
import { be16, be32 } from './sfnt';

export type CmapLookup = (cp: number) => number;

/**
 * Windows 西文代码页（cp1252）0x80~0x9F 这段的字符 -> 字节（0x81、0x8D、0x8F、0x90、0x9D 没有字符）。™（0x99）例外：
 * 实测 PowerPoint 用 Wingdings 写的 ™ 照常显示成 ™（它用东亚字体那一槽排，见 text/measure.ts EA_SLOT）
 */
const CP1252 = [0x20ac, 0, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0, 0x17d, 0,
  0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0, 0x161, 0x203a, 0x153, 0, 0x17e, 0x178];
const CP1252_BYTE = new Map(CP1252.map((u, i) => [u, 0x80 + i] as const).filter(([u]) => u));

/**
 * 符号字体里一个字对应的字节（0x20~0xFF）：本身在这个范围里的就是它，U+F020~F0FF（"插入符号"存的）减去 0xF000，
 * cp1252 里有的其它字（• – — “ ” € 等）按代码页换成字节——实测 PowerPoint：Wingdings 写的 •（U+2022）画的是 0x95 的 ⓾，
 * – — “ ” € 也都画成对应字节的符号（tools/wraptest 之外的单独实测，导出图逐个对照）
 */
export function symbolByte(cp: number): number | undefined {
  if (cp >= 0x20 && cp <= 0xff) return cp;
  if (cp >= 0xf020 && cp <= 0xf0ff) return cp - 0xf000;
  return CP1252_BYTE.get(cp);
}

export function buildCmap(t: Uint8Array): CmapLookup {
  const num = be16(t, 2);
  let best = -1, bestFmt = 0, symbol = -1;
  for (let i = 0; i < num; i++) {
    const p = be16(t, 4 + i * 8), e = be16(t, 6 + i * 8), off = be32(t, 8 + i * 8);
    const fmt = be16(t, off);
    if (p === 3 && e === 0 && fmt === 4) symbol = off;
    const unicode = (p === 3 && (e === 1 || e === 10)) || p === 0;
    if (!unicode) continue;
    if (fmt === 12 && bestFmt !== 12) { best = off; bestFmt = 12; }
    else if (fmt === 4 && bestFmt === 0) { best = off; bestFmt = 4; }
  }
  if (best >= 0) return bestFmt === 12 ? format12(t, best) : format4(t, best);
  if (symbol < 0) return () => 0;
  const f4 = format4(t, symbol);
  return (cp) => {
    const b = symbolByte(cp);
    return b !== undefined ? f4(0xf000 + b) || f4(b) : f4(cp);
  };
}

function format12(t: Uint8Array, at: number): CmapLookup {
  const groups = be32(t, at + 12);
  return (cp) => {
    let lo = 0, hi = groups - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const g = at + 16 + mid * 12;
      const start = be32(t, g), end = be32(t, g + 4);
      if (cp < start) hi = mid - 1;
      else if (cp > end) lo = mid + 1;
      else return be32(t, g + 8) + (cp - start);
    }
    return 0;
  };
}

function format4(t: Uint8Array, at: number): CmapLookup {
  const segX2 = be16(t, at + 6);
  const ends = at + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
  return (cp) => {
    if (cp > 0xffff) return 0;
    let lo = 0, hi = segX2 / 2 - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const end = be16(t, ends + mid * 2);
      const start = be16(t, starts + mid * 2);
      if (cp > end) lo = mid + 1;
      else if (cp < start) hi = mid - 1;
      else {
        const delta = be16(t, deltas + mid * 2);
        const ro = be16(t, ranges + mid * 2);
        if (ro === 0) return (cp + delta) & 0xffff;
        const gi = be16(t, ranges + mid * 2 + ro + (cp - start) * 2);
        return gi === 0 ? 0 : (gi + delta) & 0xffff;
      }
    }
    return 0;
  };
}
