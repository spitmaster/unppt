/**
 * 默认字体包（@unppt/fonts，SPEC D3）：排版按原字体（微软雅黑、宋体、Calibri……）的字宽和行高——来自只有数字的度量包，
 * 显示用对应的开源字体——字形来自开源字体文件，嵌入产物的子集也是它。
 * 每个原字体变成一个 FontFace：名字、粗斜体是原字体的，load() 给原字体的度量，source / offset 指向开源字体（子集化、出图用）。
 */
import type { InputSource } from '../io/source';
import { isWide, loadFontFile, type FontFace, type FontMetrics } from './font';
import type { WidthFace } from './library';
import { SYMBOL_FONT } from './check';
import { symbolByte } from './cmap';

/** 度量包里一个字形的概要（metrics/index.json 的一项；长度单位是字体单位） */
export interface PackFaceInfo {
  id: string;
  families: string[];
  display: string;
  bold: boolean;
  italic: boolean;
  weight: number;
  upem: number;
  ascent: number;
  descent: number;
  lineGap: number;
  strikeTop?: number;
  strikeSize?: number;
  xHeight?: number;
  generic?: FontMetrics['generic'];
  /** 有大量汉字 */
  cjk: boolean;
  /** 汉字的竖直中心（字体单位，几个方正汉字字形上下范围中点的平均） */
  cjkMid?: number;
}

/** 一个字形的字宽和字距（metrics/faces/<id>.json）：runs 是 [起始码点, 个数, 字宽]，kern 是 [左, 右, 调整量] */
export interface PackFaceData {
  runs: number[][];
  kern: number[][];
}

/** 显示对照规则（map.json）：按顺序匹配，第一条命中的生效；show 为 null 表示不提供显示字体 */
export interface PackRule {
  name?: string;
  cjk?: boolean;
  generic?: string;
  show: { regular?: string; bold?: string; light?: string; italic?: string; boldItalic?: string } | null;
}

export interface FontPack {
  faces: PackFaceInfo[];
  rules: PackRule[];
  /** 读一个字形的字宽、字距数据 */
  metrics(id: string): Promise<PackFaceData>;
  /** 显示用的开源字体文件（files/ 下的文件名）；没有这个文件时 undefined */
  file(name: string): InputSource | undefined;
}

/** 字体包里的字体排在 PPT 嵌入的字体、调用方指定的字体后面（FontFace.rank） */
export const PACK_RANK = 2;

/** 按规则给原字体挑显示用的开源字体文件 */
export function displayFile(info: Pick<PackFaceInfo, 'families' | 'bold' | 'italic' | 'weight' | 'cjk' | 'generic'>, rules: PackRule[]): string | undefined {
  for (const r of rules) {
    if (r.cjk !== undefined && r.cjk !== info.cjk) continue;
    if (r.generic !== undefined && r.generic !== info.generic) continue;
    if (r.name !== undefined) {
      const re = new RegExp(r.name, 'i');
      if (!info.families.some((f) => re.test(f))) continue;
    }
    const s = r.show;
    if (!s) return undefined;
    const bold = info.bold || info.weight >= 600;
    if (info.italic && bold) return s.boldItalic ?? s.bold ?? s.italic ?? s.regular;
    if (info.italic) return s.italic ?? s.regular;
    if (bold) return s.bold ?? s.regular;
    if (info.weight <= 350) return s.light ?? s.regular;
    return s.regular;
  }
  return undefined;
}

/**
 * 字体包里的所有字体：开源字体本身（PPT 直接写开源字体名时用，例如思源黑体、思源宋体的常规体和粗体）和原字体（度量包 + 开源字形）。
 * 开源字体是对照规则里出现的所有文件：以前只打开度量包里有原字体用到的，没有原字体对到思源宋体粗体，粗体的思源宋体只能人工加粗（10/23 全量比对发现）。
 * 字体包里有字体文件的家族不再用度量包里的同名原字体（字宽、字形以字体文件为准）：度量包里的 Noto Sans SC / Noto Serif SC 是从
 * Windows 的可变字体量的，记的是默认实例 Thin / ExtraLight 的字宽
 */
export async function packFaces(pack: FontPack): Promise<FontFace[]> {
  const opened = new Map<string, Promise<FontFace | undefined>>();
  const open = (name: string) => {
    let p = opened.get(name);
    if (!p) {
      const src = pack.file(name);
      p = src ? loadFontFile(src).then((f) => f[0], () => undefined) : Promise.resolve(undefined);
      opened.set(name, p);
    }
    return p;
  };
  const out: FontFace[] = [];
  for (const r of pack.rules) for (const file of Object.values(r.show ?? {})) if (file) await open(file);
  const own = new Set<string>();
  for (const p of opened.values()) {
    const f = await p;
    if (!f) continue;
    out.push({ ...f, rank: PACK_RANK, shownFamily: f.displayFamily });
    for (const fam of f.families) own.add(fam);
  }
  for (const info of pack.faces) {
    if (info.families.some((fam) => own.has(fam))) continue;
    const file = displayFile(info, pack.rules);
    const shown = file ? await open(file) : undefined;
    if (shown) out.push(metricFace(info, shown, () => pack.metrics(info.id)));
  }
  return out;
}

/**
 * 度量包里有、但没有显示字体的字体（Wingdings 等符号字体，map.json 里 show 为 null，SPEC D3 ⑤）：只提供字宽，
 * 没嵌入时排版仍按它的字宽（项目符号的宽度决定正文第一行从哪儿排），字形照旧用替代字体画、照样提示嵌入
 */
export function packWidthFaces(pack: FontPack): WidthFace[] {
  return pack.faces.filter((info) => !displayFile(info, pack.rules)).map((info) => {
    let p: Promise<Pick<FontMetrics, 'advance'>> | undefined;
    return {
      families: info.families, bold: info.bold, italic: info.italic,
      load: () => (p ??= pack.metrics(info.id).then((d) => ({ advance: advanceOf(info, d) }))),
    };
  });
}

/**
 * 度量包的字宽查找（单位 em）：runs 按起始码点二分。符号字体的度量按 0x20~0xFF 记（cmap.ts 的做法），
 * "插入符号"存的私用区码点 U+F020~F0FF 和 cp1252 的 • – — 等先换成字节再查（cmap.ts symbolByte）
 */
function advanceOf(info: PackFaceInfo, d: PackFaceData): (cp: number) => number | undefined {
  const starts = d.runs.map((r) => r[0]);
  const symbol = info.families.some((f) => SYMBOL_FONT.test(f));
  const find = (cp: number) => {
    let lo = 0, hi = starts.length - 1, at = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= cp) { at = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (at < 0) return undefined;
    const [s, n, w] = d.runs[at];
    return cp < s + n ? w / info.upem : undefined;
  };
  return (cp) => {
    if (!symbol) return find(cp);
    const b = symbolByte(cp);
    return b !== undefined ? find(b) : find(cp);
  };
}

function metricFace(info: PackFaceInfo, shown: FontFace, data: () => Promise<PackFaceData>): FontFace {
  let metrics: Promise<FontMetrics> | undefined;
  return {
    families: info.families, displayFamily: info.display, bold: info.bold, italic: info.italic, weight: info.weight,
    source: shown.source, offset: shown.offset, rank: PACK_RANK, shownFamily: shown.displayFamily, metricsOnly: true,
    load() {
      metrics ??= (async () => {
        const sm = await shown.load();
        return build(info, await data(), sm, info.cjkMid === undefined ? undefined : await cjkMid(sm));
      })();
      return metrics;
    },
  };
}

/** 显示字体汉字的竖直中心（em），和度量包里原字体的 cjkMid 用同样几个字量 */
async function cjkMid(m: FontMetrics): Promise<number | undefined> {
  const mids: number[] = [];
  for (const ch of '中国口田日') {
    const cs = await m.outline(ch.codePointAt(0)!).catch(() => undefined);
    const ys = (cs ?? []).flat().map((p) => p.y);
    if (ys.length) mids.push((Math.min(...ys) + Math.max(...ys)) / 2);
  }
  return mids.length ? mids.reduce((a, b) => a + b, 0) / mids.length : undefined;
}

function build(info: PackFaceInfo, d: PackFaceData, sm: FontMetrics, shownMid: number | undefined): FontMetrics {
  const u = info.upem;
  const kern = new Map<number, number>();
  for (const [l, r, v] of d.kern) kern.set(l * 0x110000 + r, v / u);
  // 汉字整体上下挪多少：原字体的汉字中心 - 显示字体的
  const midShift = shownMid !== undefined && info.cjkMid !== undefined ? info.cjkMid / u - shownMid : 0;
  const self: FontMetrics = {
    unitsPerEm: u,
    ascent: info.ascent / u, descent: info.descent / u, lineGap: info.lineGap / u,
    strikeTop: info.strikeTop === undefined ? undefined : info.strikeTop / u,
    strikeSize: info.strikeSize === undefined ? undefined : info.strikeSize / u,
    xHeight: info.xHeight === undefined ? undefined : info.xHeight / u,
    generic: info.generic,
    advance: advanceOf(info, d),
    kern: (l, r) => kern.get(l * 0x110000 + r) ?? 0,
    shown: (cp) => sm.advance(cp) !== undefined,
    // 字形轮廓（艺术字变形用）：用显示的开源字体的
    outline: (cp) => sm.outline(cp),
    displayShift(cp) {
      const w = self.advance(cp), sw = sm.advance(cp);
      if (w === undefined || sw === undefined) return undefined;
      const dy = isWide(cp) ? midShift : 0;
      // 两种字体的字宽差得多（中文引号：雅黑 Light 的 “ 只有 0.36 字宽，思源黑体是全角、笔画偏在格子一侧）时按笔画居中：
      // 按字宽居中会把笔画挪出格子（实测 PowerPoint：雅黑 Light 中文里 “ 占 0.36 字宽，笔画在自己的格子里）
      if (Math.abs(w - sw) >= 0.2) {
        return sm.outline(cp).then((cs) => {
          const xs = (cs ?? []).flat().map((p) => p.x);
          return { dx: xs.length ? w / 2 - (Math.min(...xs) + Math.max(...xs)) / 2 : (w - sw) / 2, dy };
        }, () => ({ dx: (w - sw) / 2, dy }));
      }
      const dx = (w - sw) / 2;
      return Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4 ? undefined : { dx, dy };
    },
  };
  return self;
}
