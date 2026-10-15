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
  /** p:style/a:fontRef 本身（idx 指定主题字体） */
  fontRef?: XEl;
  /** 动画用的元素编号前缀（形状的 uid），段落会追加 p0、p1… */
  uid?: string;
  /** 字体嵌入：记录每个字体用到的字，并给字体起唯一别名 */
  embed?: FontEmbedder;
  /** 渐变文字、文字阴影需要往 SVG 里加 defs */
  doc?: SvgDoc;
  /** 文本框的范围（内部坐标）：文字效果滤镜的区域；艺术字变形时渐变铺满它 */
  gradBox?: { w: number; h: number };
  /** 正在输出的这一行的外框（横向是文字宽度，竖向是行高）：渐变文字按行铺（见 svg-text.ts 的 textGradient） */
  lineBox?: { x: number; y: number; w: number; h: number };
  /** 文字开了三维效果（文本框属性里的 a:sp3d 或三维相机）：颜色按灯光方案、材质提亮（style/lighting.ts）；sp3d 用来画棱台边缘 */
  lit3d?: (c: Rgba) => Rgba;
  sp3d?: XEl;
  /** 当前部件的关系，用来解析文字上的超链接 */
  rels?: Rel[];
  /** 图片填充的文字：输出前解析好的图片地址（renderText 填） */
  blipHrefs?: Map<XEl, string>;
  /** 页码字段（a:fld type="slidenum"）显示的页码 */
  slideNumber?: number;
  /** 图片项目符号要用：图片解析和当前部件 */
  images?: ImageResolver;
  part?: string;
  /** 文字所在形状的外框上边在幻灯片上的位置（像素；形状没转动、没缩放时才给）：20 磅以下的行基线对齐整像素（text.ts） */
  pixelTop?: number;
  /** renderText 按 pixelTop 算好的基线对齐函数（文字框内的坐标） */
  snapY?: (y: number) => number;
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
  /** 符号字体（a:sym）：私用区 U+F000~F0FF 的字符用它画（"插入符号"插的 Wingdings、Symbol 等） */
  sym?: string;
  bold: boolean;
  /** 人工加粗：标了粗体但字体只有细体字形（见 emit.ts），输出时描一圈同色的边，不让浏览器换成同族的粗体 */
  fakeBold?: boolean;
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
  outline?: { color: Rgba; width: number };
  /** 文字效果（a:effectLst）：阴影、发光、内阴影、映像…… */
  effects?: XEl;
  grad?: XEl;
  /** 文字用图片填充（a:blipFill）：图片按行铺满这一行的外框，和渐变文字一样（见 svg-text.ts 的 textPicture） */
  blip?: XEl;
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
