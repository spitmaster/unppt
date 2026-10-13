/** 项目符号和自动编号 */
import { colorIn } from '../model/color';
import { attr, child, numAttr, type XEl } from '../io/xml';
import { makeAtoms, type Measurer } from './measure';
import { GROUP, resolveTypeface } from './style';
import type { Atom, Bullet, RunStyle, TextEnv } from './types';

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

/** 自动编号的计数（跨段落）：换级别、被非编号段落打断时按 PowerPoint 的规则重新计数 */
export class BulletNumbering {
  private counters = new Map<string, number>();
  private prevLvl = -1;

  /** 进入一个段落：返回要画的符号文字（不画符号返回 undefined），同时维护编号计数 */
  textFor(pPr: XEl, lvl: number, hasAtoms: boolean): { bu: XEl; text: string } | undefined {
    const autoNumCounters = this.counters;
    const prevLvl = this.prevLvl;
    let result: { bu: XEl; text: string } | undefined;
    const bu = pPr.children.find((c) => GROUP[c.name] === 'bu');
    if (lvl !== prevLvl && lvl < prevLvl) {
      for (const k of [...autoNumCounters.keys()]) if (Number(k.split('|')[0]) > lvl) autoNumCounters.delete(k);
    }
    if (bu && bu.name !== 'a:buNone' && hasAtoms) {
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
      result = { bu, text };
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
  text: string, pPr: XEl, baseStyle: RunStyle, atoms: Atom[], fontScale: number, x: number, env: TextEnv, measurer: Measurer, bu?: XEl,
): Promise<Bullet> {
  const buFont = pPr.children.find((c) => c.name === 'a:buFont');
  const buClr = pPr.children.find((c) => c.name === 'a:buClr');
  const buSzPct = pPr.children.find((c) => c.name === 'a:buSzPct');
  const buSzPts = pPr.children.find((c) => c.name === 'a:buSzPts');
  let size = baseStyle.size;
  if (buSzPct) size = baseStyle.size * (numAttr(buSzPct, 'val') ?? 100000) / 100000;
  if (buSzPts) size = (numAttr(buSzPts, 'val') ?? 1800) / 100 * fontScale * 96 / 72;
  const font = buFont ? (resolveTypeface(attr(buFont, 'typeface'), env.theme) ?? baseStyle.latin) : baseStyle.latin;
  // 实测：空格当符号时不用符号字体，而是跟正文第一个字用同一种字体（中文正文时是东亚字体的半角空格宽度）
  const buFace = !text.trim() && atoms[0]?.family ? atoms[0].family : font;
  const style: RunStyle = { ...baseStyle, size, latin: buFace, ea: buFace, color: buClr ? (colorIn(buClr, env.colors) ?? baseStyle.color) : baseStyle.color, underline: false, strike: false, spc: 0 };
  // 图片符号：实测边长约 0.70 倍字号 × 符号大小；取不到图片时退回圆点
  if (bu?.name === 'a:buBlip' && env.images && env.part) {
    const rid = attr(child(bu, 'a:blip'), 'r:embed');
    const href = rid ? await env.images.image(env.part, rid) : undefined;
    if (href) return { text: '', style, x, width: size * 0.7, family: style.latin, image: href };
  }
  const ba = await makeAtoms(text, style, measurer);
  const width = ba.reduce((s, a) => s + a.width, 0);
  return { text, style, x, width, family: ba[0]?.family ?? style.latin, face: ba[0]?.face };
}
