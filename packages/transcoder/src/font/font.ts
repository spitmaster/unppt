/**
 * 字体：自己解析 TrueType / OpenType / TTC，只读排版需要的表：
 *   name（字体名，中英文都收录）、cmap（字符 -> 字形）、hmtx/hhea（字宽）、head、OS/2（行高）、
 *   GPOS / kern（字距调整）。
 * 字体通过 RandomAccessSource 懒加载：建索引时只读表目录和 name 表，真正用到才读字宽数据。
 */
import { GlyphOutlines, type Contour } from './glyf';
import { buildKerning } from './kern';
import { buildCmap } from './cmap';
import { toSource, type InputSource, type RandomAccessSource } from '../io/source';

export interface FontFace {
  families: string[];          // 所有语言的字体名（小写）
  displayFamily: string;       // 首选显示名（英文名优先）
  bold: boolean;
  italic: boolean;
  weight: number;
  /** 字体文件来源和这个字形在文件里的偏移（TTC 合集里不为 0），子集化时用 */
  source: RandomAccessSource;
  offset: number;
  load(): Promise<FontMetrics>;
  /** 嵌入字体读出来以后发现用不了（读不出、CFF 轮廓，见 eot.ts）：按缺字体处理，字体库不再返回它 */
  unusable?: boolean;
}

export interface FontMetrics {
  unitsPerEm: number;
  ascent: number;   // 正数，单位 em
  descent: number;  // 正数，单位 em
  /** hhea 表的行间距（em）：不参与行高，只用来判断混排时要不要和另一种字体比上下伸（见 text/measure.ts） */
  lineGap: number;
  /** 返回字符宽度（单位 em）；字体里没有这个字时返回 undefined */
  advance(codePoint: number): number | undefined;
  /** 删除线：线的上沿离基线的高度和线粗（单位 em，来自 OS/2 表） */
  strikeTop?: number;
  strikeSize?: number;
  /** 小写字母 x 的高度（单位 em，OS/2 第 2 版起才有） */
  xHeight?: number;
  /** Windows 给字体归的大类（按 OS/2 的 PANOSE 推，同 GDI 的 lfPitchAndFamily）：roman 衬线、swiss 无衬线、modern 等宽、script 手写、decorative 装饰 */
  generic?: 'roman' | 'swiss' | 'modern' | 'script' | 'decorative';
  /** 两个字符之间的字距调整（单位 em，负数是挤近）；字体没有字距数据时为 0 */
  kern(left: number, right: number): number;
  /** 字形轮廓（单位 em，y 向上）；字体里没有这个字、或不是 TrueType 轮廓时为 undefined */
  outline(codePoint: number): Promise<Contour[] | undefined>;
}

export type { Contour, OutlinePoint } from './glyf';

const be16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const bes16 = (b: Uint8Array, o: number) => { const v = be16(b, o); return v & 0x8000 ? v - 0x10000 : v; };
const be32 = (b: Uint8Array, o: number) => (b[o] * 0x1000000) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
const tag = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

interface TableRec { offset: number; length: number; }

/** PANOSE 的字体类型、衬线样式、比例 -> GDI 的字体大类（按 Wine 的 GetTextMetrics 写法：等宽优先，再看衬线样式） */
function genericFamily(family: number, serif: number, proportion: number): FontMetrics['generic'] {
  if (family === 3) return 'script';
  if (family === 4 || family === 5) return 'decorative';
  if (proportion === 9) return 'modern';
  if (serif >= 2 && serif <= 10) return 'roman';
  if (serif >= 11 && serif <= 15) return 'swiss';
  return undefined;
}

async function readTables(src: RandomAccessSource, faceOffset: number): Promise<Map<string, TableRec>> {
  const head = await src.read(faceOffset, 12);
  const num = be16(head, 4);
  const dir = await src.read(faceOffset + 12, num * 16);
  const out = new Map<string, TableRec>();
  for (let i = 0; i < num; i++) {
    out.set(tag(dir, i * 16), { offset: be32(dir, i * 16 + 8), length: be32(dir, i * 16 + 12) });
  }
  return out;
}

function decodeUtf16be(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode(be16(b, i));
  return s;
}

async function readNames(src: RandomAccessSource, rec: TableRec) {
  const t = await src.read(rec.offset, rec.length);
  const count = be16(t, 2);
  const strOff = be16(t, 4);
  const fam = new Set<string>();
  let english = '';
  let typoEnglish = '';
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    const platform = be16(t, r), lang = be16(t, r + 4), nameId = be16(t, r + 6);
    const len = be16(t, r + 8), off = be16(t, r + 10);
    if (nameId !== 1 && nameId !== 4 && nameId !== 16) continue;
    const raw = t.subarray(strOff + off, strOff + off + len);
    let s: string;
    if (platform === 3 || platform === 0) s = decodeUtf16be(raw);
    else if (platform === 1 && lang === 0) s = String.fromCharCode(...raw);
    else continue;
    s = s.trim();
    if (!s) continue;
    if (nameId !== 4) fam.add(s.toLowerCase());
    if (platform === 3 && lang === 0x409 && nameId === 1) english = s;
    if (platform === 3 && lang === 0x409 && nameId === 16) typoEnglish = s;
    if (nameId === 4) fam.add(s.toLowerCase()); // 全名也可匹配，例如 "Arial Bold"
  }
  return { families: [...fam], display: typoEnglish || english || [...fam][0] || '' };
}

async function makeFace(src: RandomAccessSource, faceOffset: number): Promise<FontFace | undefined> {
  const tables = await readTables(src, faceOffset);
  const nameRec = tables.get('name');
  if (!nameRec || !tables.get('cmap') || !tables.get('hmtx')) return undefined;
  const { families, display } = await readNames(src, nameRec);
  let bold = false, italic = false, weight = 400;
  const os2 = tables.get('OS/2');
  let os2b: Uint8Array | undefined;
  if (os2) {
    os2b = await src.read(os2.offset, Math.min(os2.length, 96));
    weight = be16(os2b, 4);
    const fsSel = be16(os2b, 62);
    italic = (fsSel & 1) !== 0;
    bold = (fsSel & 32) !== 0 || weight >= 600;
  }
  let metrics: Promise<FontMetrics> | undefined;
  return {
    families, displayFamily: display, bold, italic, weight, source: src, offset: faceOffset,
    load() {
      metrics ??= loadMetrics(src, tables, os2b);
      return metrics;
    },
  };
}

async function loadMetrics(src: RandomAccessSource, tables: Map<string, TableRec>, os2b?: Uint8Array): Promise<FontMetrics> {
  const get = async (t: string) => { const r = tables.get(t)!; return src.read(r.offset, r.length); };
  const head = await get('head');
  const upem = be16(head, 18);
  const hhea = await get('hhea');
  const numHMetrics = be16(hhea, 34);
  let ascent = bes16(hhea, 4) / upem, descent = -bes16(hhea, 6) / upem, lineGap = bes16(hhea, 8) / upem;
  if (os2b && os2b.length >= 78) {
    // Windows 上 PowerPoint 用 usWinAscent / usWinDescent（行间距仍取 hhea 的）
    ascent = be16(os2b, 74) / upem;
    descent = be16(os2b, 76) / upem;
  }
  const hmtx = await get('hmtx');
  const cmap = await get('cmap');
  const lookup = buildCmap(cmap);
  const cache = new Map<number, number | undefined>();
  const kernRec = tables.get('GPOS'), kernOld = tables.get('kern');
  const kernFn = kernRec || kernOld ? buildKerning(kernRec ? await get('GPOS') : undefined, kernOld ? await get('kern') : undefined) : undefined;
  const kernCache = new Map<number, number>();
  const glyfRec = tables.get('glyf'), locaRec = tables.get('loca'), maxpRec = tables.get('maxp');
  let outlines: Promise<GlyphOutlines | undefined> | undefined;
  const outlinesOf = () => outlines ??= (async () => {
    if (!glyfRec || !locaRec || !maxpRec) return undefined;
    const maxp = await src.read(maxpRec.offset, 6);
    return new GlyphOutlines(src, glyfRec, locaRec, bes16(head, 50) === 1, upem, be16(maxp, 4));
  })();
  return {
    unitsPerEm: upem, ascent, descent, lineGap,
    strikeTop: os2b && os2b.length >= 30 ? bes16(os2b, 28) / upem : undefined,
    strikeSize: os2b && os2b.length >= 30 ? bes16(os2b, 26) / upem : undefined,
    xHeight: os2b && os2b.length >= 88 && be16(os2b, 0) >= 2 ? bes16(os2b, 86) / upem : undefined,
    generic: os2b && os2b.length >= 42 ? genericFamily(os2b[32], os2b[33], os2b[35]) : undefined,
    advance(cp) {
      if (cache.has(cp)) return cache.get(cp);
      const gid = lookup(cp);
      let w: number | undefined;
      if (gid) {
        const i = Math.min(gid, numHMetrics - 1);
        w = be16(hmtx, i * 4) / upem;
      }
      cache.set(cp, w);
      return w;
    },
    kern(left, right) {
      if (!kernFn) return 0;
      const key = left * 0x110000 + right;
      let v = kernCache.get(key);
      if (v === undefined) {
        const g1 = lookup(left), g2 = lookup(right);
        try { v = g1 && g2 ? kernFn(g1, g2) / upem : 0; } catch { v = 0; }
        if (!Number.isFinite(v)) v = 0;
        kernCache.set(key, v);
      }
      return v;
    },
    async outline(cp) {
      const gid = lookup(cp);
      const o = gid ? await outlinesOf() : undefined;
      return o ? o.glyph(gid) : undefined;
    },
  };
}

/** 从一个字体文件（可能是 TTC 合集）读出所有字形 */
export async function loadFontFile(input: InputSource): Promise<FontFace[]> {
  const src = toSource(input);
  if (src.size < 12) return [];
  const head = await src.read(0, 12);
  const sig = tag(head, 0);
  const faces: FontFace[] = [];
  try {
    if (sig === 'ttcf') {
      const n = be32(head, 8);
      const offs = await src.read(12, n * 4);
      for (let i = 0; i < n; i++) {
        const f = await makeFace(src, be32(offs, i * 4));
        if (f) faces.push(f);
      }
    } else if (sig === '\0\x01\0\0' || sig === 'OTTO' || sig === 'true') {
      const f = await makeFace(src, 0);
      if (f) faces.push(f);
    }
  } catch {
    // 损坏或不支持的字体文件直接忽略
  }
  return faces;
}

// ---------------------------------------------------------------- 字体库与测量

export class FontLibrary {
  private byFamily = new Map<string, FontFace[]>();
  readonly missing = new Set<string>();

  add(faces: FontFace[]) {
    for (const f of faces) {
      for (const fam of f.families) {
        const list = this.byFamily.get(fam) ?? [];
        list.push(f);
        this.byFamily.set(fam, list);
      }
    }
  }

  find(family: string, bold: boolean, italic: boolean): FontFace | undefined {
    const list = this.byFamily.get(family.toLowerCase().trim())?.filter((f) => !f.unusable);
    if (!list?.length) return undefined;
    let best = list[0], bestScore = -1;
    for (const f of list) {
      const score = (f.bold === bold ? 2 : 0) + (f.italic === italic ? 1 : 0) + (f.weight === 400 ? 0.1 : 0);
      if (score > bestScore) { best = f; bestScore = score; }
    }
    return best;
  }

  has(family: string): boolean {
    return !!this.byFamily.get(family.toLowerCase().trim())?.some((f) => !f.unusable);
  }
}

/** 没有字体文件时的估算字宽（单位 em） */
export function fallbackAdvance(cp: number): number {
  // 私用区的字（符号字体的 U+F0xx 等）字体里没有、又不是 a:sym 时 PowerPoint 占 1 个字号宽（实测 text-pua-nosym：雅黑、Arial、宋体、Calibri 都是）
  if (isWide(cp) || (cp >= 0xe000 && cp <= 0xf8ff)) return 1;
  if (cp === 0x20) return 0.25;
  if (cp >= 0x30 && cp <= 0x39) return 0.55;
  if ('ilI.,:;\'!|'.includes(String.fromCodePoint(cp))) return 0.25;
  if ('mwMW'.includes(String.fromCodePoint(cp))) return 0.85;
  if (cp >= 0x41 && cp <= 0x5a) return 0.65;
  return 0.5;
}

export function isWide(cp: number): boolean {
  return (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3)
    || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60)
    || (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x20000 && cp <= 0x3fffd);
}
