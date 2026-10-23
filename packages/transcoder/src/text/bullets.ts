/** 项目符号和自动编号 */
import { colorIn } from '../model/color';
import { BLIP_PART } from '../model/model';
import { attr, child, numAttr, type XEl } from '../io/xml';
import { makeAtoms, type Measurer } from './measure';
import { GROUP, resolveTypeface, scriptOf } from './style';
import type { Atom, Bullet, RunStyle, TextEnv } from './types';

const roman = (x: number) => {
  const t: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let s = '';
  for (const [v, r] of t) while (x >= v) { s += r; x -= v; }
  return s;
};
const alpha = (x: number) => { let s = ''; x--; do { s = String.fromCharCode(97 + (x % 26)) + s; x = Math.floor(x / 26) - 1; } while (x >= 0); return s; };
const CJK_DIGITS = '〇一二三四五六七八九';
/** 中文计数：十一、二十三 */
const cjkCount = (x: number) => {
  if (x < 10) return CJK_DIGITS[x];
  if (x < 20) return '十' + (x % 10 ? CJK_DIGITS[x % 10] : '');
  if (x < 100) return CJK_DIGITS[Math.floor(x / 10)] + '十' + (x % 10 ? CJK_DIGITS[x % 10] : '');
  return String(x);
};
/** 日文写法：逐位换成汉字，10 写作"一〇" */
const cjkDigits = (x: number) => [...String(x)].map((d) => CJK_DIGITS[+d]).join('');
const fullWidth = (x: number) => [...String(x)].map((d) => String.fromCharCode(0xff10 + +d)).join('');
const circled = (x: number) => (x >= 1 && x <= 20 ? String.fromCodePoint(0x2460 + x - 1) : String(x));
/** Wingdings 里的带圈数字（私用区 U+F081~F08A 白、U+F08C~F095 黑），只有 1~10，之后从 1 循环 */
const wingdingsCircled = (base: number) => (x: number) => String.fromCharCode(0xf000 + base + ((x - 1) % 10));

/** 编号样式（a:buAutoNum 的 type）：前缀 -> 数字的写法、字体（PowerPoint 365 实测：text-numbering 用例的 28 种样式） */
const SCHEMES: [string, (n: number) => string, string?][] = [
  ['romanUc', (n) => roman(n).toUpperCase()], ['romanLc', roman],
  ['alphaUc', (n) => alpha(n).toUpperCase()], ['alphaLc', alpha],
  ['circleNumWdWhite', wingdingsCircled(0x81), 'Wingdings'], ['circleNumWdBlack', wingdingsCircled(0x8c), 'Wingdings'], ['circleNum', circled],
  ['ea1JpnKor', cjkDigits], ['ea1JpnChsDb', cjkDigits], ['ea1Chs', cjkCount], ['ea1Cht', cjkCount],
  ['arabicDb', fullWidth],
];

/** 后缀：先比长的（DbPeriod 在 Period 前面） */
const SUFFIXES: [string, (core: string) => string][] = [
  ['ParenBoth', (c) => `(${c})`], ['ParenR', (c) => `${c})`], ['DbPeriod', (c) => `${c}．`], ['Period', (c) => `${c}.`],
  ['Comma', (c) => `${c}、`], ['Minus', (c) => `- ${c} -`],
];

function autoNumber(scheme: string, n: number): { text: string; font?: string } {
  const hit = SCHEMES.find(([prefix]) => scheme.startsWith(prefix));
  const core = hit ? hit[1](n) : String(n);
  const suffix = SUFFIXES.find(([end]) => scheme.endsWith(end));
  return { text: suffix ? suffix[1](core) : core, font: hit?.[2] };
}

/** 自动编号的计数（跨段落）：换级别、被非编号段落打断时按 PowerPoint 的规则重新计数 */
export class BulletNumbering {
  private counters = new Map<string, number>();
  private prevLvl = -1;

  /** 进入一个段落：返回要画的符号文字（不画符号返回 undefined），同时维护编号计数 */
  textFor(pPr: XEl, lvl: number, hasAtoms: boolean): { bu: XEl; text: string; font?: string } | undefined {
    const autoNumCounters = this.counters;
    const prevLvl = this.prevLvl;
    let result: { bu: XEl; text: string; font?: string } | undefined;
    const bu = pPr.children.find((c) => GROUP[c.name] === 'bu');
    if (lvl !== prevLvl && lvl < prevLvl) {
      for (const k of [...autoNumCounters.keys()]) if (Number(k.split('|')[0]) > lvl) autoNumCounters.delete(k);
    }
    if (bu && bu.name !== 'a:buNone' && hasAtoms) {
      let text = '';
      let font: string | undefined;
      // 多个字的符号照样都画，只有以 • 开头的只画一个 •（实测 text-buchar-multi："••"、"•••"、"•a" 都是一个 •，"ab"、"→•"、"a•" 都画全）
      if (bu.name === 'a:buChar') text = (attr(bu, 'char') ?? '•').replace(/^•.+/su, '•');
      else if (bu.name === 'a:buAutoNum') {
        const scheme = attr(bu, 'type') ?? 'arabicPeriod';
        const start = numAttr(bu, 'startAt') ?? 1;
        // 起始编号不同就是另一组，重新数（实测 text-autonum-symbol-font：startAt=3 后面不写 startAt 的段落是 1）
        const key = `${lvl}|${scheme}|${start}`;
        for (const k of [...autoNumCounters.keys()]) if (k.startsWith(`${lvl}|${scheme}|`) && k !== key) autoNumCounters.delete(k);
        const n = (autoNumCounters.get(key) ?? start - 1) + 1;
        autoNumCounters.set(key, n);
        ({ text, font } = autoNumber(scheme, n));
      } else text = '•';
      result = { bu, text, font };
    } else if (lvl === prevLvl || !bu) {
      // 非编号段落会打断同级编号
      if (!bu || bu.name !== 'a:buAutoNum') for (const k of [...autoNumCounters.keys()]) if (k.startsWith(`${lvl}|`)) autoNumCounters.delete(k);
    }
    this.prevLvl = lvl;
    return result;
  }
}

/** 按段落属性（符号字体、颜色、大小）测出符号的样式和宽度 */
export async function makeBullet(
  text: string, pPr: XEl, baseStyle: RunStyle, atoms: Atom[], fontScale: number, x: number, env: TextEnv, measurer: Measurer, bu?: XEl, numFont?: string,
): Promise<Bullet> {
  const buFont = pPr.children.find((c) => c.name === 'a:buFont');
  const buClr = pPr.children.find((c) => c.name === 'a:buClr');
  const buSzPct = pPr.children.find((c) => c.name === 'a:buSzPct');
  const buSzPts = pPr.children.find((c) => c.name === 'a:buSzPts');
  let size = baseStyle.size;
  if (buSzPct) size = baseStyle.size * (numAttr(buSzPct, 'val') ?? 100000) / 100000;
  if (buSzPts) size = (numAttr(buSzPts, 'val') ?? 1800) / 100 * fontScale * 96 / 72;
  const colorStyle = { size, color: buClr ? (colorIn(buClr, env.colors) ?? baseStyle.color) : baseStyle.color, underline: false, strike: false, spc: 0 };
  let style: RunStyle;
  if (bu?.name === 'a:buAutoNum') {
    // 编号不用 a:buFont 写的字体（+mj-lt、Arial、Courier New、宋体、Wingdings 都一样），按第一段文字的字体画：数字、字母用西文字体，
    // 中日韩编号（ea1*：一.、壹.）连后缀整个用东亚字体；编号样式自带字体（Wingdings 带圈数字）时用它
    // （实测 text-bullet-fonts：Arial + 宋体、Times New Roman + 楷体、雅黑正文 × 8 种 buFont × 12 种编号，编号宽度全部等于正文字体的）
    const ea = /^ea1/.test(attr(bu, 'type') ?? '');
    style = { ...baseStyle, ...colorStyle, latin: numFont ?? (ea ? baseStyle.ea : baseStyle.latin), ea: numFont ?? baseStyle.ea,
      latinScript: ea ? baseStyle.eaScript : baseStyle.latinScript };
  } else {
    const font = buFont ? (resolveTypeface(attr(buFont, 'typeface'), env.theme) ?? baseStyle.latin) : baseStyle.latin;
    // 实测：空格当符号时不用符号字体，而是跟正文第一个字用同一种字体（中文正文时是东亚字体的半角空格宽度）
    const buFace = !text.trim() && atoms[0]?.family ? atoms[0].family : font;
    // 符号字体没装时按它自己写的字符集找替代字体（没写或西文字符集用 Calibri，GB2312 用雅黑），和正文的字符集无关
    // （实测 text-bullet-fonts："•" 缺字体、雅黑和 Times New Roman 正文都是 Calibri 的 0.5em，标了 GB2312 的都是雅黑的宽度）
    const script = buFont && buFace === font ? scriptOf(buFont, font, env) : undefined;
    style = { ...baseStyle, ...colorStyle, latin: buFace, ea: buFace, ...(buFont && buFace === font ? { latinScript: script, eaScript: script } : {}) };
  }
  // 图片符号：实测边长约 0.70 倍字号 × 符号大小；取不到图片时退回圆点
  if (bu?.name === 'a:buBlip' && env.images && env.part) {
    const rid = attr(child(bu, 'a:blip'), 'r:embed');
    const href = rid ? await env.images.image(attr(bu, BLIP_PART) ?? env.part, rid) : undefined;
    if (href) return { text: '', style, x, width: size * 0.7, family: style.latin, image: href };
  }
  const ba = await makeAtoms(text, style, measurer);
  const width = ba.reduce((s, a) => s + a.width, 0);
  return { text, style, x, width, family: ba[0]?.family ?? style.latin, face: ba[0]?.face };
}
