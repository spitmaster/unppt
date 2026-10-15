/** 测量：按字体文件的真实字宽把文字拆成字符（Atom），缺字体时按 PowerPoint 的规则替代，含字距调整 */
import { fallbackAdvance, isWide, type FontFace, type FontMetrics } from '../font/font';
import { kernOn } from './style';
import type { Atom, FontEmbedder, RunStyle, TextEnv } from './types';

export interface Measured { metrics: FontMetrics; face: FontFace; }

export interface Measurer {
  metrics(family: string, bold: boolean, italic: boolean, quiet?: boolean): Promise<Measured | undefined>;
  embed?: FontEmbedder;
}

export function makeMeasurer(env: TextEnv): Measurer {
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

/**
 * 混排行高要和另一种字体比上下伸的字体（实测）：自己带行间距（hhea lineGap > 0.05 em，如宋体 0.14、Calibri 0.22；Arial 0.03 不算），
 * 或者下伸很小（< 0.15 em，按 em 框设计的老式中文字体：宋体、楷体、黑体、方正舒体都是 0.141）
 */
const MIX_GAP = 0.05, MIX_DESC = 0.15;

/**
 * PowerPoint 排版的最小单位是 1/8 磅（= 1/6 像素）：每个字的宽度四舍五入到这个单位，摆位置和断行都用取整后的宽度；
 * 字间距、字偶间距不取整（实测：Calibri 11 磅 40 个 "m" 每个占 8.75 磅而不是 8.787 磅；断行阈值见 linebreak.ts）
 */
export const LAYOUT_UNIT = 1 / 6;
const snapAdvance = (w: number) => Math.round(w / LAYOUT_UNIT) * LAYOUT_UNIT;

const LATIN_SUBS = ['Calibri', 'Arial', 'Liberation Sans', 'Helvetica'];
// 实测：字体标了中文字符集且本机缺失时，PowerPoint 用微软雅黑替代（样本换行 40/40 一致）
const EA_SUBS = ['Microsoft YaHei', '微软雅黑', 'DengXian', '等线', 'PingFang SC', 'Noto Sans CJK SC', 'Source Han Sans SC'];
// 实测（text-missing-font-jp）：标了日文字符集的缺失字体用 Yu Gothic（Regular，和 PANOSE 字重无关），它没有的字（简体字）再用雅黑
const JP_SUBS = ['Yu Gothic', '游ゴシック', ...EA_SUBS];
/**
 * 引号 ‘’“”：实测（text-ambiguous-punct）文字语言是中日韩时 PowerPoint 用东亚字体、按全角排，英文时用西文字体
 * （破折号、省略号、间隔号在中文里也用西文字体）
 */
const AMBIGUOUS = new Set([0x2018, 0x2019, 0x201c, 0x201d]);
const subsFor = (script: 'jp' | 'ea' | undefined, latin: boolean) => (script === 'jp' ? JP_SUBS : script === 'ea' || !latin ? EA_SUBS : LATIN_SUBS);

export async function makeAtoms(text: string, style: RunStyle, m: Measurer): Promise<Atom[]> {
  const out: Atom[] = [];
  // 缺字体时按 PowerPoint 的做法替代：西文用 Calibri（字体标了东亚字符集时也用雅黑，日文字符集用 Yu Gothic），中文用雅黑
  // 替代字体：字重跟着文字自己的加粗设置（原字体名或 PANOSE 是粗体也不加粗，实测）
  const substitute = async (subs: string[]): Promise<[Measured | undefined, string]> => {
    for (const sub of subs) {
      const sm = await m.metrics(sub, style.bold, style.italic, true);
      if (sm) return [sm, sub];
    }
    return [undefined, ''];
  };
  const pick = async (family: string, subs: string[]): Promise<[Measured | undefined, string]> => {
    const mm = await m.metrics(family, style.bold, style.italic);
    if (mm) return [mm, family];
    const [sm, sub] = await substitute(subs);
    return sm ? [sm, sub] : [undefined, family];
  };
  const [latinM, latinFam] = await pick(style.latin, subsFor(style.latinScript, true));
  const [eaM, eaFam] = style.ea === style.latin ? [latinM, latinFam] : await pick(style.ea, subsFor(style.eaScript, false));
  // 两种字体里都没有的中日韩字：用雅黑补（实测：Yu Gothic 里没有的简体字 PowerPoint 用雅黑 Regular 画）
  let cjk: Promise<[Measured | undefined, string]> | undefined;
  const [symM, symFam] = style.sym ? await pick(style.sym, []) : [undefined, ''];
  let src = text;
  if (style.caps === 'all') src = src.toUpperCase();
  const kerning = kernOn(style);
  // 实测：小型大写字母把小写字母画成大写，字号缩到 0.8 倍
  const smallCaps = style.caps === 'small' ? { ...style, size: style.size * 0.8, caps: 'none' as const } : undefined;
  let prevM: Measured | undefined;
  for (const raw of src) {
    const lower = !!smallCaps && raw !== raw.toUpperCase();
    const ch = lower ? raw.toUpperCase() : raw;
    const st = lower ? smallCaps! : style;
    const cp = ch.codePointAt(0)!;
    const wide = isWide(cp) || (st.eaLang && AMBIGUOUS.has(cp));
    const isSym = !!symM && cp >= 0xf000 && cp <= 0xf0ff;
    const primary = isSym ? symM : wide ? eaM : latinM;
    const secondary = wide ? latinM : eaM;
    let adv = primary?.metrics.advance(cp);
    let usedM = primary;
    let family = isSym ? symFam : wide ? eaFam : latinFam;
    if (adv === undefined && secondary) {
      adv = secondary.metrics.advance(cp);
      if (adv !== undefined) { usedM = secondary; family = wide ? latinFam : eaFam; }
    }
    if (adv === undefined && wide) {
      const [cm, cf] = await (cjk ??= substitute(EA_SUBS));
      adv = cm?.metrics.advance(cp);
      if (adv !== undefined) { usedM = cm; family = cf; }
    }
    const used = usedM?.metrics;
    if (usedM && adv !== undefined && m.embed && cp > 0x20) m.embed.use(usedM.face, cp);
    const size = st.baseline ? st.size * 0.67 : st.size;
    const width = snapAdvance((adv ?? fallbackAdvance(cp)) * size) + st.spc;
    // 字距调整：和前一个字同一个字体时，把成对调整量加到前一个字的宽度上
    const prevAtom = out[out.length - 1];
    if (kerning && prevAtom && adv !== undefined && usedM && usedM === prevM) prevAtom.width += usedM.metrics.kern(prevAtom.cp, cp) * size;
    prevM = adv !== undefined ? usedM : undefined;
    // 行高：有些字体（见 MIX_GAP）要和这段文字的另一种字体（西文 / 东亚）比上伸、下伸取较大的，即使这一行没有那种字；
    // 其它字体（微软雅黑、等线、华文新魏、Arial 等）只用自己的（实测）
    const other = (usedM === latinM ? eaM : latinM)?.metrics;
    const mix = !!used && !!other && (used.lineGap > MIX_GAP || used.descent < MIX_DESC);
    const asc = Math.max(used?.ascent ?? 0.92, mix ? other!.ascent : 0);
    const desc = Math.max(used?.descent ?? 0.24, mix ? other!.descent : 0);
    out.push({
      text: ch, cp, width, style: st, family, face: adv !== undefined ? usedM?.face : undefined,
      // 实测：上下标按缩小后的字号算上伸、下伸和行高
      ascent: asc * size,
      descent: desc * size,
      strikeY: (used?.strikeTop !== undefined && used.strikeSize !== undefined ? used.strikeTop - used.strikeSize / 2 : 0.25) * size,
      space: ch === ' ' || ch === '　', wide, tab: ch === '\t',
    });
  }
  return out;
}
