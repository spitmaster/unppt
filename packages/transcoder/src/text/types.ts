/** 文字排版用到的数据结构 */
import type { ColorContext, Rgba } from '../model/color';
import type { FontFace, FontLibrary } from '../font/font';
import type { Theme } from '../model/model';
import type { SvgDoc } from '../common/svg';
import type { Rel } from '../io/package';
import type { XEl } from '../io/xml';
import type { ImageResolver } from '../style/fill';

export interface TextEnv {
  colors: ColorContext;
  theme: Theme;
  fonts: FontLibrary;
  missingFonts: Set<string>;
  /** p:style/a:fontRef 指定的文字颜色 */
  fontRefColor?: Rgba;
  /** 动画用的元素编号前缀（形状的 uid），段落会追加 p0、p1… */
  uid?: string;
  /** 字体嵌入：记录每个字体用到的字，并给字体起唯一别名 */
  embed?: FontEmbedder;
  /** 渐变文字、文字阴影需要往 SVG 里加 defs */
  doc?: SvgDoc;
  /** 渐变文字铺满的范围（文本框，内部坐标） */
  gradBox?: { w: number; h: number };
  /** 文字开了三维效果（文本框属性里的 a:sp3d）：颜色按三维光照提亮；sp3d 用来画棱台边缘 */
  lit3d?: boolean;
  sp3d?: XEl;
  /** 当前部件的关系，用来解析文字上的超链接 */
  rels?: Rel[];
  /** 图片项目符号要用：图片解析和当前部件 */
  images?: ImageResolver;
  part?: string;
}

/** 字体嵌入：记录每个字体用到的字；嵌入产物的字体返回它在产物里的别名，不嵌入的返回 undefined */
export interface FontEmbedder {
  use(face: FontFace, cp: number): void;
  alias(face: FontFace): string | undefined;
}

/** 从一般到具体排列的列表样式（每个都可能含 a:lvl1pPr … a:lvl9pPr） */
export type StyleChain = (XEl | undefined)[];

export interface RunStyle {
  size: number;           // 像素
  latin: string;
  ea: string;
  bold: boolean;
  italic: boolean;
  color: Rgba;
  underline: boolean;
  /** 下划线样式（OOXML 的 u 值：sng、dbl、heavy、dotted、dash、wavy……） */
  uStyle?: string;
  strike: boolean;
  /** 双删除线 */
  dblStrike?: boolean;
  /** 荧光笔高亮 */
  highlight?: Rgba;
  baseline: number;       // 上下标，百分比（正数上标）
  spc: number;            // 字间距，像素
  /** 字距调整（kerning）从多大字号开始（磅）；没写就不调整 */
  kern?: number;
  caps: 'none' | 'all' | 'small';
  /** 西文字体标记的是东亚字符集（如 GB2312）：缺字体时西文也用东亚字体替代 */
  latinEaCharset: boolean;
  /** 字体的 PANOSE 字重 ≥ 7（粗体）：缺字体时用替代字体的粗体 */
  panoseBold: boolean;
  outline?: { color: Rgba; width: number };
  /** 文字效果（a:effectLst）：阴影、发光、内阴影、映像…… */
  effects?: XEl;
  grad?: XEl;
  /** 超链接属性（data-link / data-href） */
  link?: string;
}

/** 排版的最小单位：一个字符 */
export interface Atom {
  text: string;
  cp: number;
  width: number;
  style: RunStyle;
  family: string;
  face?: FontFace;
  ascent: number;
  descent: number;
  /** 删除线中心离基线的高度（像素） */
  strikeY: number;
  space: boolean;
  wide: boolean;
  tab: boolean;
}

/** 排好的一行 */
export interface Line {
  atoms: Atom[];
  width: number;
  size: number;   // 这一行最大的字号（像素）
  ascent: number;
  descent: number;
  x0: number;     // 文字起点（相对文本框内容区左边）
  avail: number;
}

export interface TextBox {
  x: number; y: number; w: number; h: number;
}

/** 段落的项目符号（已经测好宽度） */
export interface Bullet { text: string; style: RunStyle; x: number; width: number; family: string; face?: FontFace; image?: string }

/** 排好的一段 */
export interface ParagraphLayout { lines: Line[]; spcBef: number; spcAft: number; lineSpc: { pct?: number; pts?: number }; algn: string; bullet?: Bullet; uid?: string; }
