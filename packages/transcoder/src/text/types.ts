/** 文字排版用到的数据结构 */
import type { ColorContext, Rgba } from '../model/color';
import type { FontFace } from '../font/font';
import type { FontLibrary } from '../font/library';
import type { FontUse } from '../font/check';
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
  /** 这一页渲染时各字体名的字符集（Presentation.fontCharsets） */
  fontCharsets?: Map<string, string>;
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
  /** 字体检查：记录每个字用了什么字体 */
  fontUse?: (u: FontUse) => void;
  /** 页码字段（a:fld type="slidenum"）显示的页码 */
  slideNumber?: number;
  /** 图片项目符号要用：图片解析和当前部件 */
  images?: ImageResolver;
  part?: string;
  /** 文字所在形状的外框上边在对齐像素里的位置（形状没转动、没缩放时才给）：20 磅以下的行基线对齐整像素（text.ts） */
  pixelTop?: number;
  /** 当前坐标 -> 对齐像素的比例（不是标准宽度的幻灯片不是 1，见 DISPLAY_WIDTH） */
  pixelScale?: number;
  /** renderText 按 pixelTop 算好的基线对齐函数（文字框内的坐标） */
  snapY?: (y: number) => number;
}

/** 字体嵌入：记录每个字体用到的字；嵌入产物的字体返回它在产物里的别名，不嵌入的返回 undefined */
export interface FontEmbedder {
  use(face: FontFace, cp: number): void;
  alias(face: FontFace): string | undefined;
}

/** 从一般到具体排列的列表样式（每个都可能含 a:lvl1pPr … a:lvl9pPr）；第一项是母版级的默认样式（母版文字样式 / 演示文稿默认样式） */
export type StyleChain = (XEl | undefined)[];

export interface RunStyle {
  size: number;           // 像素
  latin: string;
  ea: string;
  /** 符号字体（a:sym）：私用区 U+F000~F0FF 的字符用它画（"插入符号"插的 Wingdings、Symbol 等） */
  sym?: string;
  /** a:sym 标了符号字符集（charset="2"，PowerPoint "插入符号"插符号字体时写）：名字不在符号字体名单里的也按符号字体检查 */
  symCharset?: boolean;
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
  /** 西文、东亚字体的字符集类别（缺字体时按它选替代字体，见 measure.ts）：jp 日文，ea 其它东亚字符集（如 GB2312） */
  latinScript?: 'jp' | 'ea';
  eaScript?: 'jp' | 'ea';
  /** 文字语言是中日韩（a:rPr lang）：引号按东亚字体、全角排（measure.ts） */
  eaLang: boolean;
  /** lang 或 altLang 是中日韩：行首禁则、标点悬挂按中文规则（linebreak.ts） */
  eaBreak: boolean;
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
  /** 宽度，含和后一个字的字距调整 */
  width: number;
  /** 和后一个字的字距调整（已算在 width 里）：后一个字折到下一行时这一行不算它 */
  kern?: number;
  style: RunStyle;
  family: string;
  face?: FontFace;
  /** 上伸、下伸（像素）：混排字体（见 measure.ts MIX_GAP）是和另一种字体比过取较大的，只在有段落标记、换行符的行里用 */
  ascent: number;
  descent: number;
  /** 混排字体自己的上伸、下伸（折行折出来、没有段落标记和换行符的行用；不混排的字没有） */
  ownAscent?: number;
  ownDescent?: number;
  /** 删除线中心离基线的高度（像素） */
  strikeY: number;
  space: boolean;
  wide: boolean;
  tab: boolean;
  /** 默认字体包：开源字体的字在原字体格子里要挪多少（像素，dy 往上为正），只影响画字，不影响排版（font/pack.ts） */
  shift?: { dx: number; dy: number };
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
  /** 没有文字区域（没有几何、宽度为 0 的形状，见 render/elements/shape.ts）：不管 a:bodyPr 的 wrap 都不换行，内边距不算 */
  bare?: boolean;
}

/** 段落的项目符号（已经测好宽度） */
export interface Bullet { text: string; style: RunStyle; x: number; width: number; family: string; face?: FontFace; image?: string }

/** 排好的一段 */
export interface ParagraphLayout { lines: Line[]; spcBef: number; spcAft: number; lineSpc: { pct?: number; pts?: number }; algn: string; bullet?: Bullet; uid?: string; fontAlgn?: string; }
