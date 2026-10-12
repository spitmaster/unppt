/**
 * 文字排版：在转码时用字体的真实字宽算好每一行，输出每行（每段样式）一个 SVG <text>。
 * 这样换行位置固定，不依赖观看者浏览器的排版。
 */
import { colorIn, css, type ColorContext, type Rgba } from './color';
import { fallbackAdvance, isWide, type FontFace, type FontLibrary, type FontMetrics } from './font';
import { EMU_PER_PX, type Theme } from './model';
import { esc, n2, type SvgDoc } from './svg';
import { shadowFilter } from './fill';
import type { Rel } from './package';
import { linkAttr } from './links';
import { attr, child, children, numAttr, type XEl } from './xml';

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
  /** 当前部件的关系，用来解析文字上的超链接 */
  rels?: Rel[];
}

export interface FontEmbedder {
  use(face: FontFace, cp: number): void;
  alias(face: FontFace): string;
}

/** 从一般到具体排列的列表样式（每个都可能含 a:lvl1pPr … a:lvl9pPr） */
export type StyleChain = (XEl | undefined)[];

// ---------------------------------------------------------------- 属性合并

const GROUP: Record<string, string> = {
  'a:noFill': 'fill', 'a:solidFill': 'fill', 'a:gradFill': 'fill', 'a:blipFill': 'fill', 'a:pattFill': 'fill', 'a:grpFill': 'fill',
  'a:buNone': 'bu', 'a:buChar': 'bu', 'a:buAutoNum': 'bu', 'a:buBlip': 'bu',
  'a:buFont': 'buFont', 'a:buFontTx': 'buFont',
  'a:buClr': 'buClr', 'a:buClrTx': 'buClr',
  'a:buSzPct': 'buSz', 'a:buSzPts': 'buSz', 'a:buSzTx': 'buSz',
};

function merge(list: (XEl | undefined)[]): XEl {
  const out: XEl = { name: 'merged', attrs: {}, children: [], text: '' };
  const byKey = new Map<string, XEl>();
  for (const el of list) {
    if (!el) continue;
    Object.assign(out.attrs, el.attrs);
    for (const c of el.children) byKey.set(GROUP[c.name] ?? c.name, c);
  }
  out.children = [...byKey.values()];
  return out;
}

function levelPPr(chain: StyleChain, lvl: number): XEl[] {
  const name = `a:lvl${lvl + 1}pPr`;
  return chain.map((s) => child(s, name)).filter((x): x is XEl => !!x);
}

// ---------------------------------------------------------------- 字体解析

function resolveTypeface(tf: string | undefined, theme: Theme): string | undefined {
  if (!tf) return undefined;
  switch (tf) {
    case '+mn-lt': return theme.minorLatin;
    case '+mj-lt': return theme.majorLatin;
    case '+mn-ea': return theme.minorEa || theme.minorLatin;
    case '+mj-ea': return theme.majorEa || theme.majorLatin;
    case '+mn-cs': case '+mj-cs': return theme.minorLatin;
  }
  return tf;
}

interface RunStyle {
  size: number;           // 像素
  latin: string;
  ea: string;
  bold: boolean;
  italic: boolean;
  color: Rgba;
  underline: boolean;
  strike: boolean;
  baseline: number;       // 上下标，百分比（正数上标）
  spc: number;            // 字间距，像素
  caps: 'none' | 'all' | 'small';
  /** 西文字体标记的是东亚字符集（如 GB2312）：缺字体时西文也用东亚字体替代 */
  latinEaCharset: boolean;
  outline?: { color: Rgba; width: number };
  shadow?: XEl;
  grad?: XEl;
  /** 超链接属性（data-link / data-href） */
  link?: string;
}

function textOutline(ln: XEl | undefined, env: TextEnv): RunStyle['outline'] {
  if (!ln || child(ln, 'a:noFill')) return undefined;
  const c = colorIn(child(ln, 'a:solidFill'), env.colors);
  if (!c) return undefined;
  return { color: c, width: Math.max(0.5, (numAttr(ln, 'w') ?? 12700) / EMU_PER_PX) };
}

function runStyle(r: XEl, env: TextEnv, scale: number): RunStyle {
  const sz = (numAttr(r, 'sz') ?? 1800) / 100;
  const latin = resolveTypeface(attr(child(r, 'a:latin'), 'typeface'), env.theme) ?? env.theme.minorLatin ?? 'Calibri';
  const ea = resolveTypeface(attr(child(r, 'a:ea'), 'typeface'), env.theme) ?? (env.theme.minorEa || latin);
  const fill = r.children.find((c) => c.name === 'a:solidFill' || c.name === 'a:gradFill' || c.name === 'a:noFill');
  let color: Rgba = env.fontRefColor ?? { r: 0, g: 0, b: 0, a: 1 };
  if (fill?.name === 'a:solidFill') color = colorIn(fill, env.colors) ?? color;
  else if (fill?.name === 'a:gradFill') color = colorIn(child(child(fill, 'a:gsLst'), 'a:gs'), env.colors) ?? color;
  else if (fill?.name === 'a:noFill') color = { ...color, a: 0 };
  let u = attr(r, 'u');
  // 带超链接的文字：PowerPoint 用主题的超链接颜色并加下划线
  const h = child(r, 'a:hlinkClick');
  const link = h && env.rels ? linkAttr(h, env.rels) : '';
  if (link) {
    const hl = colorIn({ name: 'x', attrs: {}, text: '', children: [{ name: 'a:schemeClr', attrs: { val: 'hlink' }, text: '', children: [] }] }, env.colors);
    if (hl) color = hl;
    if (!u || u === 'none') u = 'sng';
  }
  return {
    size: sz * scale * 96 / 72,
    latin, ea,
    bold: attr(r, 'b') === '1' || attr(r, 'b') === 'true',
    italic: attr(r, 'i') === '1' || attr(r, 'i') === 'true',
    color,
    underline: !!u && u !== 'none',
    strike: !!attr(r, 'strike') && attr(r, 'strike') !== 'noStrike',
    baseline: (numAttr(r, 'baseline') ?? 0) / 1000,
    spc: ((numAttr(r, 'spc') ?? 0) / 100) * 96 / 72,
    caps: (attr(r, 'cap') as RunStyle['caps']) ?? 'none',
    latinEaCharset: EA_CHARSETS.has(attr(child(r, 'a:latin'), 'charset') ?? ''),
    outline: textOutline(child(r, 'a:ln'), env),
    shadow: child(child(r, 'a:effectLst'), 'a:outerShdw'),
    grad: fill?.name === 'a:gradFill' ? fill : undefined,
    link: link || undefined,
  };
}

// ---------------------------------------------------------------- 测量

interface Measured { metrics: FontMetrics; face: FontFace; }

interface Measurer {
  metrics(family: string, bold: boolean, italic: boolean, quiet?: boolean): Promise<Measured | undefined>;
  embed?: FontEmbedder;
}

function makeMeasurer(env: TextEnv): Measurer {
  const cache = new Map<string, Promise<Measured | undefined>>();
  return {
    embed: env.embed,
    metrics(family, bold, italic, quiet) {
      const key = `${family}|${bold}|${italic}`;
      let p = cache.get(key);
      if (!p) {
        const face = env.fonts.find(family, bold, italic);
        if (!face && !quiet) env.missingFonts.add(family);
        p = face ? face.load().then((metrics) => ({ metrics, face })) : Promise.resolve(undefined);
        cache.set(key, p);
      }
      return p;
    },
  };
}

interface Atom {
  text: string;
  cp: number;
  width: number;
  style: RunStyle;
  family: string;
  face?: FontFace;
  ascent: number;
  descent: number;
  space: boolean;
  wide: boolean;
  tab: boolean;
}

const NO_START = new Set([...'、。，．・：；？！゛゜ヽヾゝゞ々ー）］｝」』〕〉》】〙〗〟’”｠»,.:;?!)]}%…‥']);
const NO_END = new Set([...'（［｛「『〔〈《【〘〖〝‘“｟«([{']);

/** 行距多出的高度放在文字上方的比例（用 PowerPoint 实测校准） */
const EXTRA_ABOVE = 2 / 3;

/** 东亚字符集：GB2312、Big5、Shift-JIS、韩文（XML 里是有符号数） */
const EA_CHARSETS = new Set(['-122', '-120', '-128', '-127', '134', '136', '128', '129']);

const LATIN_SUBS = ['Calibri', 'Arial', 'Liberation Sans', 'Helvetica'];
// 实测：字体标了中文字符集且本机缺失时，PowerPoint 用微软雅黑替代（样本换行 40/40 一致）
const EA_SUBS = ['Microsoft YaHei', '微软雅黑', 'DengXian', '等线', 'PingFang SC', 'Noto Sans CJK SC', 'Source Han Sans SC'];

async function makeAtoms(text: string, style: RunStyle, m: Measurer): Promise<Atom[]> {
  const out: Atom[] = [];
  // 缺字体时按 PowerPoint 的做法替代：西文用 Calibri（字体标了东亚字符集时也用雅黑），中文用雅黑
  const pick = async (family: string, subs: string[]): Promise<[Measured | undefined, string]> => {
    const mm = await m.metrics(family, style.bold, style.italic);
    if (mm) return [mm, family];
    for (const sub of subs) {
      const sm = await m.metrics(sub, style.bold, style.italic, true);
      if (sm) return [sm, sub];
    }
    return [undefined, family];
  };
  const [latinM, latinFam] = await pick(style.latin, style.latinEaCharset ? EA_SUBS : LATIN_SUBS);
  const [eaM, eaFam] = style.ea === style.latin ? [latinM, latinFam] : await pick(style.ea, EA_SUBS);
  let src = text;
  if (style.caps === 'all') src = src.toUpperCase();
  for (const ch of src) {
    const cp = ch.codePointAt(0)!;
    const wide = isWide(cp);
    const primary = wide ? eaM : latinM;
    const secondary = wide ? latinM : eaM;
    let adv = primary?.metrics.advance(cp);
    let usedM = primary;
    let family = wide ? eaFam : latinFam;
    if (adv === undefined && secondary) {
      adv = secondary.metrics.advance(cp);
      if (adv !== undefined) { usedM = secondary; family = wide ? latinFam : eaFam; }
    }
    const used = usedM?.metrics;
    if (usedM && adv !== undefined && m.embed && cp > 0x20) m.embed.use(usedM.face, cp);
    const size = style.baseline ? style.size * 0.67 : style.size;
    const width = (adv ?? fallbackAdvance(cp)) * size + style.spc;
    out.push({
      text: ch, cp, width, style, family, face: adv !== undefined ? usedM?.face : undefined,
      ascent: (used?.ascent ?? 0.92) * style.size,
      descent: (used?.descent ?? 0.24) * style.size,
      space: ch === ' ' || ch === '　', wide, tab: ch === '\t',
    });
  }
  return out;
}

// ---------------------------------------------------------------- 段落与换行

interface Line {
  atoms: Atom[];
  width: number;
  size: number;   // 这一行最大的字号（像素）
  ascent: number;
  descent: number;
  x0: number;     // 文字起点（相对文本框内容区左边）
  avail: number;
}

function canBreakBetween(a: Atom, b: Atom): boolean {
  if (NO_START.has(b.text) || NO_END.has(a.text)) return false;
  if (a.space || a.tab) return true;
  if (a.wide || b.wide) return true;
  if (a.text === '-' || a.text === '/') return true;
  return false;
}

function breakLines(atoms: Atom[], avail: (first: boolean) => number, wrap: boolean): Atom[][] {
  const lines: Atom[][] = [];
  let start = 0;
  while (start < atoms.length) {
    const max = avail(lines.length === 0);
    let width = 0;
    let lastBreak = -1;
    let i = start;
    let forced = -1;
    for (; i < atoms.length; i++) {
      const a = atoms[i];
      if (a.text === '\n') { forced = i; break; }
      if (i > start && canBreakBetween(atoms[i - 1], a)) lastBreak = i;
      const w = width + a.width;
      if (wrap && w > max + 0.01 && i > start && !a.space) {
        break;
      }
      width = w;
    }
    if (forced >= 0) {
      lines.push(atoms.slice(start, forced));
      start = forced + 1;
      if (start === atoms.length) lines.push([]);
      continue;
    }
    if (i >= atoms.length) {
      lines.push(atoms.slice(start));
      break;
    }
    let end = lastBreak > start ? lastBreak : i;
    lines.push(atoms.slice(start, end));
    // 行首的空格吞掉
    while (end < atoms.length && atoms[end].space) end++;
    start = end;
  }
  return lines;
}

function trimmedWidth(atoms: Atom[]): number {
  let w = 0;
  let last = atoms.length - 1;
  while (last >= 0 && atoms[last].space) last--;
  for (let i = 0; i <= last; i++) w += atoms[i].width;
  return w;
}

// ---------------------------------------------------------------- 项目符号

function autoNumber(scheme: string, n: number): string {
  const roman = (x: number) => {
    const t: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
    let s = '';
    for (const [v, r] of t) while (x >= v) { s += r; x -= v; }
    return s;
  };
  const alpha = (x: number) => { let s = ''; x--; do { s = String.fromCharCode(97 + (x % 26)) + s; x = Math.floor(x / 26) - 1; } while (x >= 0); return s; };
  const cjk = (x: number) => {
    const d = '〇一二三四五六七八九';
    if (x < 10) return d[x];
    if (x < 20) return '十' + (x % 10 ? d[x % 10] : '');
    if (x < 100) return d[Math.floor(x / 10)] + '十' + (x % 10 ? d[x % 10] : '');
    return String(x);
  };
  const circled = (x: number) => (x >= 1 && x <= 20 ? String.fromCodePoint(0x2460 + x - 1) : String(x));
  let core: string;
  if (scheme.startsWith('romanUc')) core = roman(n).toUpperCase();
  else if (scheme.startsWith('romanLc')) core = roman(n);
  else if (scheme.startsWith('alphaUc')) core = alpha(n).toUpperCase();
  else if (scheme.startsWith('alphaLc')) core = alpha(n);
  else if (scheme.startsWith('circleNum')) core = circled(n);
  else if (scheme.startsWith('ea1Chs') || scheme.startsWith('ea1Cht')) core = cjk(n);
  else core = String(n);
  if (scheme.endsWith('ParenBoth')) return `(${core})`;
  if (scheme.endsWith('ParenR')) return `${core})`;
  if (scheme.endsWith('Period')) return `${core}.`;
  if (scheme.endsWith('Comma') || scheme.includes('DbComma')) return `${core}、`;
  if (scheme.endsWith('DbPeriod')) return `${core}．`;
  if (scheme.endsWith('Minus')) return `- ${core} -`;
  return core;
}

// ---------------------------------------------------------------- 主入口

export interface TextBox {
  x: number; y: number; w: number; h: number;
}

/**
 * 排版并输出 SVG。bodyPrs 从一般到具体（母版 -> 版式 -> 形状）。
 * 返回 SVG 片段；没有文字时返回空串。
 */
export async function renderText(
  txBody: XEl | undefined,
  chain: StyleChain,
  bodyPrs: (XEl | undefined)[],
  box: TextBox,
  env: TextEnv,
  out?: { height: number },
): Promise<string> {
  if (!txBody) return '';
  const paras = children(txBody, 'a:p');
  if (!paras.length) return '';
  const hasText = paras.some((p) => p.children.some((r) => (r.name === 'a:r' || r.name === 'a:fld') && (child(r, 'a:t')?.text ?? '').length > 0));
  if (!hasText) return '';

  const bp = merge([...bodyPrs, child(txBody, 'a:bodyPr')]);
  const ins = (k: string, d: number) => (numAttr(bp, k) ?? d) / EMU_PER_PX;
  const lIns = ins('lIns', 91440), rIns = ins('rIns', 91440), tIns = ins('tIns', 45720), bIns = ins('bIns', 45720);
  const wrap = attr(bp, 'wrap') !== 'none';
  const anchor = attr(bp, 'anchor') ?? 't';
  const vert = attr(bp, 'vert') ?? 'horz';
  const norm = child(bp, 'a:normAutofit');
  const fontScale = (numAttr(norm, 'fontScale') ?? 100000) / 100000;
  const lnReduce = (numAttr(norm, 'lnSpcReduction') ?? 0) / 100000;
  const vertical = vert !== 'horz';
  // 竖排时汉字保持正立（eaVert、mongolianVert、wordArtVert）；vert / vert270 是整体旋转
  const uprightWide = vert === 'eaVert' || vert === 'mongolianVert' || vert === 'wordArtVert' || vert === 'wordArtVertRtl';
  const uprightAll = vert === 'wordArtVert' || vert === 'wordArtVertRtl';
  // 列（行）的排列方向：mongolianVert、vert270 从左往右，其余竖排从右往左
  const linesLeftToRight = vert === 'mongolianVert';
  const numCol = vertical ? 1 : Math.max(1, numAttr(bp, 'numCol') ?? 1);
  const spcCol = (numAttr(bp, 'spcCol') ?? 0) / EMU_PER_PX;

  const outer = vertical ? { x: 0, y: 0, w: box.h, h: box.w } : { x: 0, y: 0, w: box.w, h: box.h };
  const contentW = Math.max(1, (outer.w - lIns - rIns - (numCol - 1) * spcCol) / numCol);
  // 实测：渐变文字的渐变铺满整个文本框，而不是文字本身的范围
  env.gradBox = { w: outer.w, h: outer.h };
  const measurer = makeMeasurer(env);
  const lstStyle = child(txBody, 'a:lstStyle');
  // 形状样式（p:style/a:fontRef）指定的文字颜色：优先级高于默认文字样式，低于形状自己的列表样式和文字属性
  const fontRefStyle = env.fontRefColor ? fontRefLevels(env.fontRefColor) : undefined;
  const fullChain: StyleChain = [...chain, fontRefStyle, lstStyle];

  interface PLayout { lines: Line[]; spcBef: number; spcAft: number; lineSpc: { pct?: number; pts?: number }; algn: string; bullet?: { text: string; style: RunStyle; x: number; width: number; family: string; face?: FontFace }; uid?: string; }
  const layouts: PLayout[] = [];
  const autoNumCounters = new Map<string, number>();
  let prevLvl = -1;

  for (let pi = 0; pi < paras.length; pi++) {
    const p = paras[pi];
    const pPrEl = child(p, 'a:pPr');
    const lvl = numAttr(pPrEl, 'lvl') ?? 0;
    const levels = levelPPr(fullChain, lvl);
    const pPr = merge([...levels, pPrEl]);
    const defRPr = merge([...levels.map((l) => child(l, 'a:defRPr')), child(pPrEl, 'a:defRPr')]);

    // 收集原子
    const atoms: Atom[] = [];
    let firstStyle: RunStyle | undefined;
    for (const r of p.children) {
      if (r.name === 'a:r' || r.name === 'a:fld') {
        const style = runStyle(merge([defRPr, child(r, 'a:rPr')]), env, fontScale);
        firstStyle ??= style;
        atoms.push(...await makeAtoms(child(r, 'a:t')?.text ?? '', style, measurer));
      } else if (r.name === 'a:br') {
        const style = runStyle(merge([defRPr, child(r, 'a:rPr')]), env, fontScale);
        firstStyle ??= style;
        atoms.push({ text: '\n', cp: 10, width: 0, style, family: style.latin, ascent: 0, descent: 0, space: false, wide: false, tab: false });
      }
    }
    const endStyle = runStyle(merge([defRPr, child(p, 'a:endParaRPr')]), env, fontScale);
    const baseStyle = firstStyle ?? endStyle;
    const baseM = (await measurer.metrics(baseStyle.latin, baseStyle.bold, baseStyle.italic, true)
      ?? await measurer.metrics(baseStyle.ea, baseStyle.bold, baseStyle.italic, true))?.metrics;
    const emptyAsc = (baseM?.ascent ?? 0.92) * endStyle.size;
    const emptyDesc = (baseM?.descent ?? 0.24) * endStyle.size;

    // 制表符：跳到下一个默认制表位
    const defTab = (numAttr(pPr, 'defTabSz') ?? 914400) / EMU_PER_PX;

    const marL = (numAttr(pPr, 'marL') ?? 0) / EMU_PER_PX;
    const indent = (numAttr(pPr, 'indent') ?? 0) / EMU_PER_PX;
    const algn = attr(pPr, 'algn') ?? 'l';

    // 项目符号
    let bullet: PLayout['bullet'];
    const bu = pPr.children.find((c) => GROUP[c.name] === 'bu');
    if (lvl !== prevLvl && lvl < prevLvl) {
      for (const k of [...autoNumCounters.keys()]) if (Number(k.split('|')[0]) > lvl) autoNumCounters.delete(k);
    }
    if (bu && bu.name !== 'a:buNone' && atoms.length) {
      const buFont = pPr.children.find((c) => c.name === 'a:buFont');
      const buClr = pPr.children.find((c) => c.name === 'a:buClr');
      const buSzPct = pPr.children.find((c) => c.name === 'a:buSzPct');
      const buSzPts = pPr.children.find((c) => c.name === 'a:buSzPts');
      let text = '';
      if (bu.name === 'a:buChar') text = attr(bu, 'char') ?? '•';
      else if (bu.name === 'a:buAutoNum') {
        const scheme = attr(bu, 'type') ?? 'arabicPeriod';
        const key = `${lvl}|${scheme}`;
        const start = numAttr(bu, 'startAt') ?? 1;
        const n = (autoNumCounters.get(key) ?? start - 1) + 1;
        autoNumCounters.set(key, n);
        text = autoNumber(scheme, n);
      } else text = '•';
      let size = baseStyle.size;
      if (buSzPct) size = baseStyle.size * (numAttr(buSzPct, 'val') ?? 100000) / 100000;
      if (buSzPts) size = (numAttr(buSzPts, 'val') ?? 1800) / 100 * fontScale * 96 / 72;
      const font = buFont ? (resolveTypeface(attr(buFont, 'typeface'), env.theme) ?? baseStyle.latin) : baseStyle.latin;
      const style: RunStyle = { ...baseStyle, size, latin: font, ea: font, color: buClr ? (colorIn(buClr, env.colors) ?? baseStyle.color) : baseStyle.color, underline: false, strike: false, spc: 0 };
      const ba = await makeAtoms(text, style, measurer);
      const width = ba.reduce((s, a) => s + a.width, 0);
      bullet = { text, style, x: marL + indent, width, family: ba[0]?.family ?? style.latin, face: ba[0]?.face };
    } else if (lvl === prevLvl || !bu) {
      // 非编号段落会打断同级编号
      if (!bu || bu.name !== 'a:buAutoNum') for (const k of [...autoNumCounters.keys()]) if (k.startsWith(`${lvl}|`)) autoNumCounters.delete(k);
    }
    prevLvl = lvl;

    let firstX = marL + (indent >= 0 ? indent : 0);
    if (bullet && bullet.x + bullet.width > firstX) firstX = bullet.x + bullet.width + (indent >= 0 ? 0 : 0);
    if (!bullet && indent < 0) firstX = marL + indent;
    const availFirst = contentW - firstX;
    const availRest = contentW - marL;

    // 处理制表符宽度（简化：按默认制表位）
    let acc = 0;
    for (const a of atoms) {
      if (a.text === '\n') { acc = 0; continue; }
      if (a.tab) { const next = (Math.floor(acc / defTab) + 1) * defTab; a.width = next - acc; }
      acc += a.width;
    }

    const rows = breakLines(atoms, (first) => (first ? availFirst : availRest), wrap);
    const lines: Line[] = rows.map((row, i) => {
      const vis = row.filter((a) => a.text !== '\n');
      return {
        atoms: vis,
        width: trimmedWidth(vis),
        size: vis.length ? Math.max(...vis.map((a) => a.style.size)) : endStyle.size,
        ascent: vis.length ? Math.max(...vis.map((a) => a.ascent)) : emptyAsc,
        descent: vis.length ? Math.max(...vis.map((a) => a.descent)) : emptyDesc,
        x0: i === 0 ? firstX : marL,
        avail: i === 0 ? availFirst : availRest,
      };
    });
    if (!lines.length) lines.push({ atoms: [], width: 0, size: endStyle.size, ascent: emptyAsc, descent: emptyDesc, x0: marL, avail: availRest });

    const spc = (el: XEl | undefined) => {
      const pct = child(el, 'a:spcPct');
      const pts = child(el, 'a:spcPts');
      if (pts) return { pts: (numAttr(pts, 'val') ?? 0) / 100 };
      if (pct) return { pct: (numAttr(pct, 'val') ?? 100000) / 100000 };
      return undefined;
    };
    const ls = spc(pPr.children.find((c) => c.name === 'a:lnSpc')) ?? { pct: 1 };
    if (ls.pct !== undefined) ls.pct = Math.max(0.1, ls.pct - lnReduce);
    const toPx = (s: { pct?: number; pts?: number } | undefined, ref: number) =>
      !s ? 0 : s.pts !== undefined ? s.pts * 96 / 72 : (s.pct ?? 0) * ref;
    const refH = (lines[0].ascent + lines[0].descent) * 1.2;
    layouts.push({
      lines,
      // 实测：自动缩小（lnSpcReduction）只减行距，不减段前段后
      spcBef: toPx(spc(pPr.children.find((c) => c.name === 'a:spcBef')), refH),
      spcAft: toPx(spc(pPr.children.find((c) => c.name === 'a:spcAft')), refH),
      lineSpc: ls,
      algn,
      bullet,
      uid: env.uid ? `${env.uid}p${pi}` : undefined,
    });
  }

  // 计算总高度
  const lineHeight = (l: Line, s: PLayout['lineSpc']) =>
    s.pts !== undefined ? s.pts * 96 / 72 : l.size * 1.2 * (s.pct ?? 1);
  let total = 0;
  layouts.forEach((pl, i) => {
    if (i > 0) total += pl.spcBef;
    for (const l of pl.lines) total += lineHeight(l, pl.lineSpc);
    if (i < layouts.length - 1) total += pl.spcAft;
  });
  if (out) out.height = total + tIns + bIns;
  const availH = outer.h - tIns - bIns;
  let y = tIns + (numCol > 1 ? 0 : anchor === 'ctr' ? (availH - total) / 2 : anchor === 'b' ? availH - total : 0);
  let col = 0;

  const parts: string[] = [];
  for (let i = 0; i < layouts.length; i++) {
    const pl = layouts[i];
    if (i > 0) y += pl.spcBef;
    const pParts: string[] = [];
    pl.lines.forEach((line, li) => {
      const lh = lineHeight(line, pl.lineSpc);
      // 分栏：这一栏放不下就换到下一栏顶部
      if (numCol > 1 && col < numCol - 1 && y + lh > tIns + availH + 0.5 && y > tIns) { col++; y = tIns; }
      const colX = col * (contentW + spcCol);
      // 行距大于单倍时，多出的空间加在行的上方
      // PowerPoint 单倍行高 = 1.2 × 字号；基线按字体的上下伸比例放在这 1.2 倍的行框里。
      // 多倍/固定行距多出（或少掉）的高度，实测约 2/3 在文字上方、1/3 在下方。
      const box = line.size * 1.2;
      const natural = line.ascent + line.descent || 1;
      // 行距小于单倍时，减少的高度全部从文字上方扣（实测更接近）
      let baseline = y + (lh - box) * (lh < box ? 1 : EXTRA_ABOVE) + box * (line.ascent / natural);
      // 列从左往右排的竖排：把行的位置翻过来（行内基线位置不变）
      if (linesLeftToRight) baseline = outer.h - y - lh + (baseline - y);
      let x = lIns + colX + line.x0;
      const free = line.avail - line.width;
      if (pl.algn === 'ctr') x += free / 2;
      else if (pl.algn === 'r') x += free;
      let extra = 0;
      if (((pl.algn === 'just' && li < pl.lines.length - 1) || pl.algn === 'dist') && wrap && free > 0) {
        const gaps = line.atoms.filter((a, k) => k < line.atoms.length - 1 && (a.space || a.wide)).length;
        extra = gaps ? free / gaps : 0;
      }
      if (li === 0 && pl.bullet) {
        const b = pl.bullet;
        const bx = pl.algn === 'l' || pl.algn === 'just' ? lIns + colX + b.x : x - b.width;
        const bAlias = b.face && env.embed ? env.embed.alias(b.face) : undefined;
        pParts.push(textEl(b.text, bx, baseline, b.style, b.family, true, bAlias, env));
      }
      // 先算每个字的横坐标，再按样式、字体分段输出（两端对齐时在每个间隙处分段）
      const atoms = line.atoms;
      const xs: number[] = [];
      let cx = x;
      for (const a of atoms) {
        xs.push(cx);
        cx += a.width + (extra && (a.space || a.wide) ? extra : 0);
      }
      let s0 = 0;
      for (let k = 1; k <= atoms.length; k++) {
        const a = atoms[k];
        const p = atoms[k - 1];
        const upright = (q: Atom) => (uprightAll || (uprightWide && q.wide)) && !q.space;
        const boundary = k === atoms.length || a.style !== p.style || a.family !== p.family || a.face !== p.face || (extra > 0 && (p.space || p.wide)) || upright(a) || upright(p);
        if (!boundary) continue;
        const seg = atoms.slice(s0, k);
        const s = seg[0].style;
        const txt = seg.map((q) => (q.tab ? ' ' : q.text)).join('');
        const shift = s.baseline ? -s.baseline / 100 * s.size : 0;
        const st = s.baseline ? { ...s, size: s.size * 0.67 } : s;
        const alias = seg[0].face && env.embed ? env.embed.alias(seg[0].face) : undefined;
        if (seg.length === 1 && upright(seg[0])) {
          // 竖排里正立的字：以字的中心为轴转回来
          const cx = xs[s0] + seg[0].width / 2;
          const cy = baseline - st.size * 0.38;
          pParts.push(`<g transform="rotate(-90 ${n2(cx)} ${n2(cy)})">${textEl(txt, cx, baseline + shift, st, seg[0].family, false, alias, env, 'middle')}</g>`);
        } else if (txt.trim().length || s.underline || s.strike) pParts.push(textEl(txt, xs[s0], baseline + shift, st, seg[0].family, false, alias, env));
        s0 = k;
      }
      y += lh;
    });
    if (i < layouts.length - 1) y += pl.spcAft;
    if (pParts.length) parts.push(pl.uid ? `<g data-uid="${pl.uid}">${pParts.join('')}</g>` : pParts.join(''));
  }
  if (!parts.length) return '';

  let transform = `translate(${n2(box.x)} ${n2(box.y)})`;
  if (vert === 'vert270') transform = `translate(${n2(box.x)} ${n2(box.y + box.h)}) rotate(-90)`;
  else if (vertical) transform = `translate(${n2(box.x + box.w)} ${n2(box.y)}) rotate(90)`;
  return `<g transform="${transform}">${parts.join('')}</g>`;
}

/** 只写测量时实际用的字体：保证浏览器显示的字宽和转码时算的一致 */
function fontRefLevels(c: Rgba): XEl {
  const hex = [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('');
  const clr: XEl = { name: 'a:srgbClr', attrs: { val: hex }, text: '', children: c.a < 1 ? [{ name: 'a:alpha', attrs: { val: String(Math.round(c.a * 100000)) }, text: '', children: [] }] : [] };
  const defRPr: XEl = { name: 'a:defRPr', attrs: {}, text: '', children: [{ name: 'a:solidFill', attrs: {}, text: '', children: [clr] }] };
  const levels: XEl[] = [];
  for (let i = 1; i <= 9; i++) levels.push({ name: `a:lvl${i}pPr`, attrs: {}, text: '', children: [defRPr] });
  return { name: 'a:lstStyle', attrs: {}, text: '', children: levels };
}

function fontList(primary: string, alias?: string): string {
  return `${alias ? `'${alias}',` : ''}'${primary.replace(/'/g, '')}',sans-serif`;
}

function textEl(txt: string, x: number, y: number, s: RunStyle, family: string, bullet = false, alias?: string, env?: TextEnv, anchor?: string): string {
  let a = `${bullet ? 'data-bu="1" ' : ''}x="${n2(x)}" y="${n2(y)}" font-family="${esc(fontList(family, alias))}" font-size="${n2(s.size)}" fill="${css(s.color)}"`;
  if (s.color.a < 0.999) a += ` fill-opacity="${n2(s.color.a)}"`;
  if (s.bold) a += ' font-weight="bold"';
  if (s.italic) a += ' font-style="italic"';
  const deco = [s.underline ? 'underline' : '', s.strike ? 'line-through' : ''].filter(Boolean).join(' ');
  if (deco) a += ` text-decoration="${deco}"`;
  if (s.spc) a += ` letter-spacing="${n2(s.spc)}"`;
  if (anchor) a += ` text-anchor="${anchor}"`;
  if (s.link) a += `${s.link} style="cursor:pointer"`;
  if (s.outline) a += ` stroke="${css(s.outline.color)}" stroke-width="${n2(s.outline.width)}"${s.outline.color.a < 0.999 ? ` stroke-opacity="${n2(s.outline.color.a)}"` : ''} paint-order="stroke"`;
  const doc = env?.doc;
  if (doc && s.grad) {
    const id = doc.id('tg');
    const ang = ((numAttr(child(s.grad, 'a:lin'), 'ang') ?? 0) / 60000) * Math.PI / 180;
    const gb = env!.gradBox ?? { w: 1, h: 1 };
    const dx = Math.cos(ang) / 2, dy = Math.sin(ang) / 2;
    const stops = children(child(s.grad, 'a:gsLst'), 'a:gs').map((g) => {
      const c = colorIn(g, env!.colors) ?? { r: 0, g: 0, b: 0, a: 1 };
      return `<stop offset="${n2((numAttr(g, 'pos') ?? 0) / 100000)}" stop-color="${css(c)}"${c.a < 0.999 ? ` stop-opacity="${n2(c.a)}"` : ''}/>`;
    }).join('');
    doc.addDef(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n2((0.5 - dx) * gb.w)}" y1="${n2((0.5 - dy) * gb.h)}" x2="${n2((0.5 + dx) * gb.w)}" y2="${n2((0.5 + dy) * gb.h)}">${stops}</linearGradient>`);
    a = a.replace(/ fill="[^"]*"( fill-opacity="[^"]*")?/, ` fill="url(#${id})"`);
  }
  if (doc && s.shadow && env) {
    const fid = shadowFilter({ name: 'a:effectLst', attrs: {}, text: '', children: [s.shadow] }, env.colors, doc);
    if (fid) a += ` filter="url(#${fid})"`;
  }
  return `<text ${a} xml:space="preserve">${esc(txt)}</text>`;
}
