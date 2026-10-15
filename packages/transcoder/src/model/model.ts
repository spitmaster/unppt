/**
 * 演示文稿模型：读取 presentation.xml、母版、版式、主题，提供继承查找。
 * 母版、版式、主题会缓存（数量少）；幻灯片逐页读取、用完即丢。
 */
import type { ColorContext } from './color';
import { OpcPackage } from '../io/package';
import { attr, child, children, expandAlternate, numAttr, path, type XEl } from '../io/xml';
import { scanFontCharsets } from './font-charsets';

export const EMU_PER_PX = 9525;

/**
 * 对齐像素用的显示宽度：PowerPoint 画形状、图片、图表、文字时对齐的是渲染时的像素（实测），参考图和常见显示都是宽 1280；
 * 标准 16:9 幻灯片正好 1280 像素宽（1 像素 = 1 个显示像素），4:3（960 宽）等其它尺寸按比例换算。
 * 实测（PowerPoint 导出 8 种宽度的幻灯片，量矩形边缘）：渲染分辨率取整数 DPI——round(96 × 1280 / 宽度)，在这个网格上对齐、
 * 再缩放到输出尺寸（1281 宽按 96 DPI，和幻灯片像素一样对齐）；7 种非整倍宽度里 5 种这个模型误差最小
 */
export const DISPLAY_WIDTH = 1280;

export interface Theme {
  part: string;
  colors: Record<string, string>;
  majorLatin: string; minorLatin: string;
  majorEa: string; minorEa: string;
  /** 主题字体里按脚本写的东亚字体（a:font script="Hans" 等），东亚字体为空时按文字语言选（text/style.ts） */
  majorScripts: Record<string, string>; minorScripts: Record<string, string>;
  /** a:ea 本身写的东亚字体（可能为空） */
  majorEaOwn: string; minorEaOwn: string;
  fillStyles: XEl[];
  lineStyles: XEl[];
  effectStyles: XEl[];
  bgFillStyles: XEl[];
}

export interface Placeholder { type: string; idx?: string; el: XEl; }

export interface Master {
  part: string;
  xml: XEl;
  theme: Theme;
  clrMap: Record<string, string>;
  placeholders: Placeholder[];
  txStyles: { title?: XEl; body?: XEl; other?: XEl };
}

export interface Layout {
  part: string;
  xml: XEl;
  master: Master;
  clrMap: Record<string, string>;
  placeholders: Placeholder[];
}

export interface SlideRef { part: string; index: number; hidden: boolean; }

const DEFAULT_CLRMAP: Record<string, string> = {
  bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2',
  accent1: 'accent1', accent2: 'accent2', accent3: 'accent3', accent4: 'accent4', accent5: 'accent5', accent6: 'accent6',
  hlink: 'hlink', folHlink: 'folHlink',
};

function readClrMap(el: XEl | undefined): Record<string, string> | undefined {
  if (!el) return undefined;
  return { ...DEFAULT_CLRMAP, ...el.attrs };
}

function readTheme(xml: XEl | undefined, part: string): Theme {
  const el = path(xml, 'a:themeElements');
  const colors: Record<string, string> = {};
  for (const c of children(child(el, 'a:clrScheme'))) {
    const key = c.name.slice(2);
    const v = c.children[0];
    if (!v) continue;
    colors[key] = v.name === 'a:sysClr' ? (v.attrs.lastClr ?? '000000') : (v.attrs.val ?? '000000');
  }
  const fonts = child(el, 'a:fontScheme');
  const fontOf = (k: string, script: 'a:latin' | 'a:ea') => {
    const f = child(fonts, k);
    let tf = attr(child(f, script), 'typeface') ?? '';
    if (!tf && script === 'a:ea') {
      // 中文文档常把东亚字体写在 <a:font script="Hans">
      tf = children(f, 'a:font').find((x) => x.attrs.script === 'Hans')?.attrs.typeface ?? '';
    }
    return tf;
  };
  const scripts = (k: string) => Object.fromEntries(children(child(fonts, k), 'a:font').map((x) => [x.attrs.script ?? '', x.attrs.typeface ?? '']));
  const own = (k: string) => attr(child(child(fonts, k), 'a:ea'), 'typeface') ?? '';
  const fmt = child(el, 'a:fmtScheme');
  return {
    part,
    colors,
    majorLatin: fontOf('a:majorFont', 'a:latin'), minorLatin: fontOf('a:minorFont', 'a:latin'),
    majorEa: fontOf('a:majorFont', 'a:ea'), minorEa: fontOf('a:minorFont', 'a:ea'),
    majorScripts: scripts('a:majorFont'), minorScripts: scripts('a:minorFont'),
    majorEaOwn: own('a:majorFont'), minorEaOwn: own('a:minorFont'),
    fillStyles: children(child(fmt, 'a:fillStyleLst')),
    lineStyles: children(child(fmt, 'a:lnStyleLst')),
    effectStyles: children(child(fmt, 'a:effectStyleLst')),
    bgFillStyles: children(child(fmt, 'a:bgFillStyleLst')),
  };
}

function collectPlaceholders(spTree: XEl | undefined): Placeholder[] {
  const out: Placeholder[] = [];
  for (const sp of expandAlternate(children(spTree))) {
    const nv = sp.children.find((c) => c.name.startsWith('p:nv'));
    const ph = path(nv, 'p:nvPr', 'p:ph');
    if (ph) out.push({ type: attr(ph, 'type') ?? 'obj', idx: attr(ph, 'idx'), el: sp });
  }
  return out;
}

export function phInfo(sp: XEl): { type: string; idx?: string } | undefined {
  const nv = sp.children.find((c) => c.name.startsWith('p:nv'));
  const ph = path(nv, 'p:nvPr', 'p:ph');
  if (!ph) return undefined;
  return { type: attr(ph, 'type') ?? 'obj', idx: attr(ph, 'idx') };
}

const TITLE_TYPES = new Set(['title', 'ctrTitle']);

/** 在版式或母版的占位符里找匹配项 */
export function matchPlaceholder(list: Placeholder[], ph: { type: string; idx?: string }, isMaster: boolean): XEl | undefined {
  if (isMaster) {
    const t = TITLE_TYPES.has(ph.type) ? 'title'
      : ['dt', 'ftr', 'sldNum', 'hdr'].includes(ph.type) ? ph.type : 'body';
    return list.find((p) => p.type === t)?.el ?? (t === 'body' ? list.find((p) => p.type === 'obj')?.el : undefined);
  }
  if (ph.idx !== undefined) {
    const byIdx = list.find((p) => p.idx === ph.idx);
    if (byIdx) return byIdx.el;
  }
  const t = ph.type === 'ctrTitle' ? ['ctrTitle', 'title'] : ph.type === 'subTitle' ? ['subTitle', 'body'] : [ph.type];
  for (const ty of t) {
    const m = list.find((p) => p.type === ty);
    if (m) return m.el;
  }
  return undefined;
}

/** 演示文稿里嵌入的一个字体文件（p:embeddedFontLst） */
export interface EmbeddedFontRef { typeface: string; part: string; bold: boolean; italic: boolean; }

export class Presentation {
  width = 0;
  height = 0;
  slides: SlideRef[] = [];
  embeddedFonts: EmbeddedFontRef[] = [];
  /** 第一页的页码（p:presentation 的 firstSlideNum，默认 1） */
  firstSlideNum = 1;
  /** 放映设置（presProps.xml 的 p:showPr）：循环放映、是否使用计时；都是默认值时为 undefined */
  show?: { loop?: boolean; useTimings?: boolean };
  defaultTextStyle?: XEl;
  /** 幻灯片像素 -> 对齐像素的比例（DISPLAY_WIDTH / 宽度；标准 16:9 是 1） */
  displayScale = 1;
  /** 每页渲染时各字体名的字符集（见 font-charsets.ts），按页序：小写字体名 -> charset */
  fontCharsets: Map<string, string>[] = [];
  presPart = '';
  private masters = new Map<string, Master>();
  private layouts = new Map<string, Layout>();
  private themes = new Map<string, Theme>();
  readonly warnings = new Map<string, number>();

  constructor(public pkg: OpcPackage) {}

  warn(msg: string) {
    this.warnings.set(msg, (this.warnings.get(msg) ?? 0) + 1);
  }

  async load() {
    const root = await this.pkg.rels('');
    const office = root.find((r) => r.type === 'officeDocument');
    if (!office) throw new Error('找不到演示文稿主部件');
    this.presPart = office.target;
    const pres = await this.pkg.xml(this.presPart);
    if (!pres) throw new Error('演示文稿主部件为空');
    const sz = child(pres, 'p:sldSz');
    this.width = Math.round((numAttr(sz, 'cx') ?? 9144000) / EMU_PER_PX);
    this.height = Math.round((numAttr(sz, 'cy') ?? 6858000) / EMU_PER_PX);
    this.displayScale = this.width > 0 ? Math.round(96 * DISPLAY_WIDTH / this.width) / 96 : 1;
    this.defaultTextStyle = child(pres, 'p:defaultTextStyle');
    this.firstSlideNum = numAttr(pres, 'firstSlideNum') ?? 1;
    const rels = await this.pkg.rels(this.presPart);
    let i = 0;
    for (const s of children(child(pres, 'p:sldIdLst'), 'p:sldId')) {
      const rel = rels.find((r) => r.id === attr(s, 'r:id'));
      if (!rel) continue;
      this.slides.push({ part: rel.target, index: i++, hidden: false });
    }
    this.fontCharsets = await scanFontCharsets(this.pkg, this.presPart, this.slides.map((s) => s.part));
    const propsRel = rels.find((r) => r.type === 'presProps');
    const showPr = child(propsRel ? await this.pkg.xml(propsRel.target) : undefined, 'p:showPr');
    const on = (k: string) => { const v = attr(showPr, k); return v === undefined ? undefined : v === '1' || v === 'true'; };
    if (on('loop') || on('useTimings') === false) this.show = { ...(on('loop') ? { loop: true } : {}), ...(on('useTimings') === false ? { useTimings: false } : {}) };
    const slots: [string, boolean, boolean][] = [['p:regular', false, false], ['p:bold', true, false], ['p:italic', false, true], ['p:boldItalic', true, true]];
    for (const ef of children(child(pres, 'p:embeddedFontLst'), 'p:embeddedFont')) {
      const typeface = attr(child(ef, 'p:font'), 'typeface');
      if (!typeface) continue;
      for (const [tag, bold, italic] of slots) {
        const rel = rels.find((r) => r.id === attr(child(ef, tag), 'r:id'));
        if (rel && !rel.external) this.embeddedFonts.push({ typeface, part: rel.target, bold, italic });
      }
    }
  }

  async theme(part: string): Promise<Theme> {
    let t = this.themes.get(part);
    if (!t) {
      t = readTheme(await this.pkg.xml(part), part);
      this.themes.set(part, t);
    }
    return t;
  }

  async master(part: string): Promise<Master> {
    let m = this.masters.get(part);
    if (m) return m;
    const xml = tagBlipBullets((await this.pkg.xml(part))!, part);
    const themeRel = await this.pkg.relByType(part, 'theme');
    const tx = child(xml, 'p:txStyles');
    m = {
      part, xml,
      theme: await this.theme(themeRel?.target ?? ''),
      clrMap: readClrMap(child(xml, 'p:clrMap')) ?? DEFAULT_CLRMAP,
      placeholders: collectPlaceholders(path(xml, 'p:cSld', 'p:spTree')),
      txStyles: { title: child(tx, 'p:titleStyle'), body: child(tx, 'p:bodyStyle'), other: child(tx, 'p:otherStyle') },
    };
    this.masters.set(part, m);
    return m;
  }

  async layout(part: string): Promise<Layout> {
    let l = this.layouts.get(part);
    if (l) return l;
    const xml = tagBlipBullets((await this.pkg.xml(part))!, part);
    const masterRel = await this.pkg.relByType(part, 'slideMaster');
    const master = await this.master(masterRel?.target ?? '');
    const ovr = path(xml, 'p:clrMapOvr', 'a:overrideClrMapping');
    l = {
      part, xml, master,
      clrMap: readClrMap(ovr) ?? master.clrMap,
      placeholders: collectPlaceholders(path(xml, 'p:cSld', 'p:spTree')),
    };
    this.layouts.set(part, l);
    return l;
  }
}

/** 母版、版式里的图片符号（a:buBlip）记下所在部件：幻灯片继承它时，r:embed 要按母版、版式自己的关系表找 */
export const BLIP_PART = 'unppt:part';
function tagBlipBullets(el: XEl, part: string): XEl {
  for (const c of el.children) {
    if (c.name === 'a:buBlip') c.attrs[BLIP_PART] ??= part;
    else tagBlipBullets(c, part);
  }
  return el;
}

/** 渲染一页时用到的上下文 */
export interface SlideContext {
  pres: Presentation;
  part: string;          // 当前正在渲染的部件（幻灯片、版式或母版），用来解析关系
  layout: Layout;
  master: Master;
  theme: Theme;
  colors: ColorContext;
  /** 当前幻灯片的页码（页码字段 a:fld type="slidenum" 显示它；母版、版式上的页码字段也显示所在幻灯片的页码） */
  slideNumber?: number;
  /** 当前元素是不是幻灯片本身的（版式、母版上的元素不参与动画） */
  ownSlide: boolean;
  /** 所在的三维场景（SmartArt 三维样式整张图共用的相机，w、h 是场景的大小）：拉伸的侧面按它的视角画 */
  scene?: { scene3d: XEl; w: number; h: number };
  /**
   * 当前坐标系到对齐像素（显示像素，见 DISPLAY_WIDTH）的换算（像素 x = x + sx × 当前 x）：标准尺寸的幻灯片顶层不写
   * （就是幻灯片坐标）；在转动、翻转的组合里是 null（换算不是简单的平移缩放）。形状、图片、图表、文字按它对齐整像素
   */
  toSlide?: SlideMapping | null;
  /** 这一页渲染时各字体名的字符集（Presentation.fontCharsets） */
  fontCharsets?: Map<string, string>;
}

export interface SlideMapping { x: number; y: number; sx: number; sy: number }

export function colorContext(theme: Theme, clrMap: Record<string, string>): ColorContext {
  return { scheme: theme.colors, map: clrMap };
}
