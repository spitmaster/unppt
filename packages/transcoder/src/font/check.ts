/**
 * 字体检查（unppt check / checkFonts）：排版时记下每个字用了什么字体，按文字要的字体名汇总成结论——
 * PPT 嵌入的、调用方指定的、默认字体包（显示用哪个开源字体）、找不到被替代的、符号字体没嵌入，以及哪些字没有字形。
 */
import type { FontFace } from './font';

/** 排版时每个字用了什么字体：requested 是文字要的字体，picked 是按名字找到或替代来的字体，
 * face 是实际画这个字的字形来源（没有字形时 undefined）；symbol：这个字是"插入符号"（a:sym）插的，requested 是那个符号字体 */
export interface FontUse { requested: string; picked: string; pickedFace?: FontFace; face?: FontFace; cp: number; symbol?: boolean }

/** 符号字体：字母的位置上放的是图形（Wingdings 等），换成别的字体就变成普通字母（SPEC D3） */
export const SYMBOL_FONT = /wingdings|webdings|^symbol$|marlett|mt extra|bookshelf symbol|ms reference specialty|ms outlook|segoe mdl2 assets|segoe fluent icons/i;

export type FontStatus = 'embedded' | 'specified' | 'default' | 'substituted' | 'symbol-missing' | 'missing';

export interface FontCheckEntry {
  /** 文字要的字体名 */
  font: string;
  /** 用到它的页（从 1 开始，含母版、版式上的文字） */
  pages: number[];
  /**
   * embedded：PPT 里嵌入了，照原样显示；specified：调用方指定的字体；default：默认字体包，按原字体的字宽排版、用开源字体显示；
   * substituted：没有这个字体，按 PowerPoint 的规则换成 substitute；symbol-missing：符号字体没嵌入，符号会显示成字母；
   * missing：连替代字体都没有（没给字体包时），字宽只能估算
   */
  status: FontStatus;
  /** 替代用的字体（substituted、symbol-missing） */
  substitute?: string;
  /** 显示用的字体（默认字体包里的开源字体名，或嵌入、指定的字体本身） */
  shownWith?: string;
}

export interface FontCheck {
  fonts: FontCheckEntry[];
  /** 没有任何字体有字形的字（交给浏览器兜底显示，不同设备可能不同） */
  missingChars: { page: number; chars: string }[];
  /** 必须处理的问题数（symbol-missing、missing） */
  errors: number;
  /** 提醒数（substituted，以及有字没有字形的页） */
  warnings: number;
}

const ORDER: FontStatus[] = ['embedded', 'specified', 'default', 'substituted', 'symbol-missing', 'missing'];

export class FontCheckLog {
  private fonts = new Map<string, { pages: Set<number>; status: FontStatus; substitute?: string; shownWith?: string }>();
  private chars = new Map<number, Set<string>>();

  /** embedded：这个字体是不是 PPT 里嵌入的 */
  constructor(private embedded: (f: FontFace) => boolean) {}

  record(u: FontUse, page: number) {
    const key = u.requested;
    if (!key) return;
    // 符号字体只用在空格上（常见：整段设成 Wingdings 的空行、项目符号后的空格）：没有要显示的符号，不算问题
    if ((u.symbol || SYMBOL_FONT.test(key)) && (u.cp <= 0x20 || /\s/u.test(String.fromCodePoint(u.cp)))) return;
    const status = this.classify(u);
    let e = this.fonts.get(key.toLowerCase());
    if (!e) { e = { pages: new Set(), status: status.status }; this.fonts.set(key.toLowerCase(), e); }
    e.pages.add(page);
    // 同一个字体名在不同地方结论不同时取最严重的
    if (ORDER.indexOf(status.status) >= ORDER.indexOf(e.status)) Object.assign(e, status);
    if (!u.face && u.cp > 0x20 && !/\s/u.test(String.fromCodePoint(u.cp)) && !(u.cp >= 0x200b && u.cp <= 0x200f) && u.cp !== 0xfeff) {
      let s = this.chars.get(page);
      if (!s) { s = new Set(); this.chars.set(page, s); }
      s.add(String.fromCodePoint(u.cp));
    }
    this.names.set(key.toLowerCase(), key);
  }

  private names = new Map<string, string>();

  private classify(u: FontUse): { status: FontStatus; substitute?: string; shownWith?: string } {
    const f = u.pickedFace;
    // "插入符号"的字体（Euclid Symbol、FontAwesome 等名字不在 SYMBOL_FONT 里的也算）没嵌入：请作者嵌入，不是缺字体包
    const symbol = u.symbol || SYMBOL_FONT.test(u.requested);
    if (!f) return { status: symbol ? 'symbol-missing' : 'missing' };
    if (u.picked.toLowerCase() !== u.requested.toLowerCase()) {
      return { status: symbol ? 'symbol-missing' : 'substituted', substitute: u.picked, shownWith: f.shownFamily ?? f.displayFamily };
    }
    if (this.embedded(f)) return { status: 'embedded', shownWith: f.displayFamily };
    if ((f.rank ?? 0) > 0) return { status: 'default', shownWith: f.shownFamily ?? f.displayFamily };
    return { status: 'specified', shownWith: f.displayFamily };
  }

  result(): FontCheck {
    const fonts: FontCheckEntry[] = [...this.fonts.entries()].map(([k, e]) => ({
      font: this.names.get(k) ?? k, pages: [...e.pages].sort((a, b) => a - b), status: e.status,
      ...(e.substitute ? { substitute: e.substitute } : {}), ...(e.shownWith ? { shownWith: e.shownWith } : {}),
    })).sort((a, b) => ORDER.indexOf(b.status) - ORDER.indexOf(a.status) || a.pages[0] - b.pages[0] || a.font.localeCompare(b.font));
    const missingChars = [...this.chars.entries()].sort((a, b) => a[0] - b[0]).map(([page, s]) => ({ page, chars: [...s].join('') }));
    const errors = fonts.filter((f) => f.status === 'symbol-missing' || f.status === 'missing').length;
    const warnings = fonts.filter((f) => f.status === 'substituted').length + missingChars.length;
    return { fonts, missingChars, errors, warnings };
  }
}
