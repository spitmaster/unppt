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

const LATIN_SUBS = ['Calibri', 'Arial', 'Liberation Sans', 'Helvetica'];
// 实测：字体标了中文字符集且本机缺失时，PowerPoint 用微软雅黑替代（样本换行 40/40 一致）
const EA_SUBS = ['Microsoft YaHei', '微软雅黑', 'DengXian', '等线', 'PingFang SC', 'Noto Sans CJK SC', 'Source Han Sans SC'];

export async function makeAtoms(text: string, style: RunStyle, m: Measurer): Promise<Atom[]> {
  const out: Atom[] = [];
  // 缺字体时按 PowerPoint 的做法替代：西文用 Calibri（字体标了东亚字符集时也用雅黑），中文用雅黑
  const pick = async (family: string, subs: string[]): Promise<[Measured | undefined, string]> => {
    const mm = await m.metrics(family, style.bold, style.italic);
    if (mm) return [mm, family];
    // 替代字体：原字体是粗体字重（看 PANOSE）时用替代字体的粗体
    for (const sub of subs) {
      const sm = await m.metrics(sub, style.bold || style.panoseBold, style.italic, true);
      if (sm) return [sm, sub];
    }
    return [undefined, family];
  };
  const [latinM, latinFam] = await pick(style.latin, style.latinEaCharset ? EA_SUBS : LATIN_SUBS);
  const [eaM, eaFam] = style.ea === style.latin ? [latinM, latinFam] : await pick(style.ea, EA_SUBS);
  let src = text;
  if (style.caps === 'all') src = src.toUpperCase();
  const kerning = kernOn(style);
  let prevM: Measured | undefined;
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
    // 字距调整：和前一个字同一个字体时，把成对调整量加到前一个字的宽度上
    const prevAtom = out[out.length - 1];
    if (kerning && prevAtom && adv !== undefined && usedM && usedM === prevM) prevAtom.width += usedM.metrics.kern(prevAtom.cp, cp) * size;
    prevM = adv !== undefined ? usedM : undefined;
    out.push({
      text: ch, cp, width, style, family, face: adv !== undefined ? usedM?.face : undefined,
      ascent: (used?.ascent ?? 0.92) * style.size,
      descent: (used?.descent ?? 0.24) * style.size,
      space: ch === ' ' || ch === '　', wide, tab: ch === '\t',
    });
  }
  return out;
}
