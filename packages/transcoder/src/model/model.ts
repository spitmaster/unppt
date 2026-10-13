/**
 * 演示文稿模型：读取 presentation.xml、母版、版式、主题，提供继承查找。
 * 母版、版式、主题会缓存（数量少）；幻灯片逐页读取、用完即丢。
 */
import type { ColorContext } from './color';
import { OpcPackage } from '../io/package';
import { attr, child, children, expandAlternate, numAttr, path, type XEl } from '../io/xml';

export const EMU_PER_PX = 9525;

export interface Theme {
  part: string;
  colors: Record<string, string>;
  majorLatin: string; minorLatin: string;
  majorEa: string; minorEa: string;
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
  const fmt = child(el, 'a:fmtScheme');
  return {
    part,
    colors,
    majorLatin: fontOf('a:majorFont', 'a:latin'), minorLatin: fontOf('a:minorFont', 'a:latin'),
    majorEa: fontOf('a:majorFont', 'a:ea'), minorEa: fontOf('a:minorFont', 'a:ea'),
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
  /** 放映设置（presProps.xml 的 p:showPr）：循环放映、是否使用计时；都是默认值时为 undefined */
  show?: { loop?: boolean; useTimings?: boolean };
  defaultTextStyle?: XEl;
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
    this.defaultTextStyle = child(pres, 'p:defaultTextStyle');
    const rels = await this.pkg.rels(this.presPart);
    let i = 0;
    for (const s of children(child(pres, 'p:sldIdLst'), 'p:sldId')) {
      const rel = rels.find((r) => r.id === attr(s, 'r:id'));
      if (!rel) continue;
      this.slides.push({ part: rel.target, index: i++, hidden: false });
    }
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
    const xml = (await this.pkg.xml(part))!;
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
    const xml = (await this.pkg.xml(part))!;
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

/** 渲染一页时用到的上下文 */
export interface SlideContext {
  pres: Presentation;
  part: string;          // 当前正在渲染的部件（幻灯片、版式或母版），用来解析关系
  layout: Layout;
  master: Master;
  theme: Theme;
  colors: ColorContext;
  /** 当前元素是不是幻灯片本身的（版式、母版上的元素不参与动画） */
  ownSlide: boolean;
}

export function colorContext(theme: Theme, clrMap: Record<string, string>): ColorContext {
  return { scheme: theme.colors, map: clrMap };
}
