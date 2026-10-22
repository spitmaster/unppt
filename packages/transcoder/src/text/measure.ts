/** 测量：按字体文件的真实字宽把文字拆成字符（Atom），缺字体时按 PowerPoint 的规则替代，含字距调整 */
import { fallbackAdvance, isWide, type FontFace, type FontMetrics } from '../font/font';
import { kernOn } from './style';
import type { Atom, FontEmbedder, RunStyle, TextEnv } from './types';

export interface Measured { metrics: FontMetrics; face: FontFace; }

export interface Measurer {
  metrics(family: string, bold: boolean, italic: boolean, quiet?: boolean): Promise<Measured | undefined>;
  /** 没有可用字体时原字体的字宽（FontLibrary.widths） */
  widths?(family: string, bold: boolean, italic: boolean): Promise<Pick<FontMetrics, 'advance'> | undefined>;
  /** 这个字体是嵌入了、但 PowerPoint 不用的（metrics 返回之后才知道） */
  unusable?(family: string): boolean;
  embed?: FontEmbedder;
  fontUse?: TextEnv['fontUse'];
}

export function makeMeasurer(env: TextEnv): Measurer {
  const cache = new Map<string, Promise<Measured | undefined>>();
  const unusable = new Set<string>();
  return {
    embed: env.embed,
    fontUse: env.fontUse,
    unusable: (family) => unusable.has(family.toLowerCase()),
    widths: async (family, bold, italic) => env.fonts.widths(family, bold, italic),
    metrics(family, bold, italic, quiet) {
      const key = `${family}|${bold}|${italic}`;
      let p = cache.get(key);
      if (!p) {
        const face = env.fonts.find(family, bold, italic);
        if (!face && !quiet) env.missingFonts.add(family);
        // 嵌入字体第一次用到时才读出来，读出来发现用不了（unusable）的不用它，替代字体见 makeAtoms
        p = face ? face.load().then(async (metrics) => {
          if (!face.unusable) return { metrics, face };
          // 本机装了同名的字体就用它（样本：嵌入的微软雅黑表目录没排序，PowerPoint 用系统里的雅黑）；
          // find 现在会跳过这个用不了的嵌入字体
          const sys = env.fonts.find(family, bold, italic);
          if (sys && !sys.unusable) return { metrics: await sys.load(), face: sys };
          unusable.add(family.toLowerCase());
          if (!quiet) env.missingFonts.add(family);
          return undefined;
        }) : Promise.resolve(undefined);
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

/**
 * 人工加粗（标了粗体、字体没有粗体字形）每个字多占 字号磅数 × 8 / 字体的每 em 单位数（四舍五入，.5 进位）个排版单位（1/8 磅）。
 * 实测 PowerPoint COM 二分框宽：每 em 256 单位的老字体（宋体、黑体、楷体、仿宋、幼圆、隶书、方正舒体）16 磅起 +1/8 磅、48 磅起 +2/8、
 * 80 磅起 +3/8；华文细黑（1000）66 磅起才 +1/8，雅黑 Light（2048）136 磅起才 +1/8；汉字和西文一样；有粗体字形的字体不加
 */
const fakeBoldExtra = (sizePx: number, upem: number) => Math.floor((sizePx * 0.75 * 8) / upem + 0.5) * LAYOUT_UNIT;

const LATIN_SUBS = ['Calibri', 'Arial', 'Liberation Sans', 'Helvetica'];
// 实测：字体标了中文字符集且本机缺失时，PowerPoint 用微软雅黑替代（样本换行 40/40 一致）
const EA_SUBS = ['Microsoft YaHei', '微软雅黑', 'DengXian', '等线', 'PingFang SC', 'Noto Sans CJK SC', 'Source Han Sans SC'];
// 实测（text-missing-font-jp）：标了日文字符集的缺失字体用 Yu Gothic（Regular，和 PANOSE 字重无关），它没有的字（简体字）再用雅黑
const JP_SUBS = ['Yu Gothic', '游ゴシック', ...EA_SUBS];
/**
 * 嵌入了、但 PowerPoint 不用的字体（CFF 轮廓、表目录没排序，见 font/eot.ts）：PowerPoint 用宋体画，中西文都是（样本实测：
 * 两份嵌入 CFF 思源黑体的课件整页都是宋体，数字也是宋体的衬线体），不是一般缺字体的雅黑 / Calibri。中性用例做不出来
 * （手工拼的 EOT PowerPoint 不认），按样本定
 */
const SONG_SUBS = ['SimSun', '宋体', 'NSimSun', '新宋体', 'Songti SC', 'Noto Serif CJK SC', 'Source Han Serif SC'];
/**
 * 没装时 PowerPoint 换成别的字体的名字（实测 text-font-substitutes：Helvetica、Helvetica Neue、Helv 画成 Arial，Times、Tms Rmn 画成
 * Times New Roman，Courier 画成 Courier New；楷体_GB2312、仿宋_GB2312 不换成楷体、仿宋）
 */
const ALIAS: Record<string, string> = {
  helvetica: 'Arial', 'helvetica neue': 'Arial', helv: 'Arial', times: 'Times New Roman', 'tms rmn': 'Times New Roman', courier: 'Courier New',
};
/** 不走宋体的嵌入字体：样本里嵌入的 PingFang SC（CFF）PowerPoint 用雅黑画（像一般缺字体），大概 Office 自带苹果字体的替代表 */
const MAPPED = /^pingfang/i;
/**
 * 引号 ‘’“”：实测（text-ambiguous-punct）文字语言是中日韩时 PowerPoint 用东亚字体、按全角排，英文时用西文字体
 * （破折号、省略号、间隔号在中文里也用西文字体）
 */
const AMBIGUOUS = new Set([0x2018, 0x2019, 0x201c, 0x201d]);
/**
 * 宽度不定的字里，不管文字语言都用东亚字体排的（西文字体里有字形也不用；实测 text-ea-slot-symbols：§ ¨ ° ± × ÷ ™ ↔、
 * 带圈数字、几何图形、杂项符号；· – — … ← → ≤ ≥ √ 希腊字母等仍用西文字体）
 */
const EA_SLOT = new Set([0xa7, 0xa8, 0xb0, 0xb1, 0xd7, 0xf7, 0x2122, 0x2194]);
export const eaSlot = (cp: number) => EA_SLOT.has(cp) || (cp >= 0x2460 && cp <= 0x24ff) || (cp >= 0x25a0 && cp <= 0x26ff);
const subsFor = (script: 'jp' | 'ea' | undefined, latin: boolean) => (script === 'jp' ? JP_SUBS : script === 'ea' || !latin ? EA_SUBS : LATIN_SUBS);

/** 默认字体包的字：开源字体的字在原字体格子里的挪动量换成像素（Atom.shift） */
const shiftOf = (d: { dx: number; dy: number } | undefined, size: number) => (d ? { shift: { dx: d.dx * size, dy: d.dy * size } } : {});

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
    const alias = ALIAS[family.toLowerCase()];
    const am = alias ? await m.metrics(alias, style.bold, style.italic) : undefined;
    if (am) return [am, alias!];
    const [sm, sub] = await substitute(m.unusable?.(family) && !MAPPED.test(family) ? [...SONG_SUBS, ...subs] : subs);
    return sm ? [sm, sub] : [undefined, family];
  };
  const [latinM, latinFam] = await pick(style.latin, subsFor(style.latinScript, true));
  const [eaM, eaFam] = style.ea === style.latin ? [latinM, latinFam] : await pick(style.ea, subsFor(style.eaScript, false));
  // 宽度不定的标点（引号、破折号……）在中日韩语言里按东亚字体、全角排；实测（text-ambiguous-missing-ea）：东亚字体缺失、
  // 又没标字符集时 PowerPoint 改用西文字体（窄），标了 GB2312 等字符集的照样全角
  const ambiguousEa = style.eaLang && ((!!eaM && eaFam === style.ea) || !!style.eaScript);
  // 两种字体里都没有的中日韩字：用雅黑补（实测：Yu Gothic 里没有的简体字 PowerPoint 用雅黑 Regular 画）
  let cjk: Promise<[Measured | undefined, string]> | undefined;
  let latinFallback: Promise<[Measured | undefined, string]> | undefined;
  const [symM, symFam] = style.sym ? await pick(style.sym, []) : [undefined, ''];
  // 换成了替代字体的（没嵌入的 Wingdings 等）：字宽仍按原字体（度量包里有的话），字形用替代字体画
  const origWidths = (requested: string | undefined, picked: string) =>
    requested && picked.toLowerCase() !== requested.toLowerCase() ? m.widths?.(requested, style.bold, style.italic) : undefined;
  const [latinW, eaW, symW] = await Promise.all([origWidths(style.latin, latinFam), origWidths(style.ea, eaFam), origWidths(style.sym, symFam)]);
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
    // eaFont：用东亚字体排；wide：按中日韩字断行、两端对齐时拉开（EA_SLOT 的字只在中日韩语言里算）
    const eaFont = isWide(cp) || (ambiguousEa && AMBIGUOUS.has(cp)) || eaSlot(cp);
    const wide = isWide(cp) || (ambiguousEa && AMBIGUOUS.has(cp)) || (eaSlot(cp) && style.eaBreak);
    const isSym = !!symM && cp >= 0xf000 && cp <= 0xf0ff;
    const primary = isSym ? symM : eaFont ? eaM : latinM;
    const secondary = eaFont ? latinM : eaM;
    let adv = primary?.metrics.advance(cp);
    let usedM = primary;
    let family = isSym ? symFam : eaFont ? eaFam : latinFam;
    // EA_SLOT 的字东亚字体里没有时先用雅黑补，再退回西文字体（实测：宋体没有 ↔、楷体没有 ™，PowerPoint 排成雅黑的宽度）
    const slotFirst = eaSlot(cp) && !isWide(cp);
    const tryCjk = async () => {
      // 东亚字体是没有汉字的西文字体时，衬线体、手写体用宋体补，其它用雅黑（实测 text-ea-latin-cjk：Times New Roman、Georgia、Cambria、
      // Palatino、Garamond、Comic Sans 是宋体；Arial、Calibri、Verdana、Segoe UI、Courier New、Consolas 是雅黑）
      const g = eaM?.metrics.generic;
      const [cm, cf] = await (cjk ??= substitute(g === 'roman' || g === 'script' ? [...SONG_SUBS, ...EA_SUBS] : EA_SUBS));
      adv = cm?.metrics.advance(cp);
      if (adv !== undefined) { usedM = cm; family = cf; }
    };
    if (adv === undefined && slotFirst) await tryCjk();
    if (adv === undefined && secondary) {
      adv = secondary.metrics.advance(cp);
      if (adv !== undefined) { usedM = secondary; family = eaFont ? latinFam : eaFam; }
    }
    if (adv === undefined && eaFont && !slotFirst) await tryCjk();
    // 西文字体、东亚字体里都没有的西文字（黑体没有不间断空格 U+00A0）：PowerPoint 用 Calibri 的字宽（实测 tools/wraptest：黑体 20 磅
    // 不间断空格占 4.4~4.6 磅，Calibri 是 0.226 字号）
    if (adv === undefined && !eaFont) {
      const [lm, lf] = await (latinFallback ??= substitute(LATIN_SUBS));
      adv = lm?.metrics.advance(cp);
      if (adv !== undefined) { usedM = lm; family = lf; }
    }
    const used = usedM?.metrics;
    if (usedM && adv !== undefined && m.embed && cp > 0x20) m.embed.use(usedM.face, cp);
    const size = st.baseline ? st.size * 0.67 : st.size;
    const fakeBold = !!st.bold && adv !== undefined && !!usedM && !usedM.face.bold;
    const origAdv = (isSym ? symW : eaFont ? eaW : latinW)?.advance(cp);
    const width = snapAdvance((origAdv ?? adv ?? fallbackAdvance(cp)) * size) + (fakeBold ? fakeBoldExtra(size, usedM!.metrics.unitsPerEm) : 0) + st.spc;
    // 字距调整：和前一个字同一个字体时，把成对调整量加到前一个字的宽度上
    const prevAtom = out[out.length - 1];
    if (kerning && prevAtom && adv !== undefined && usedM && usedM === prevM) {
      const k = usedM.metrics.kern(prevAtom.cp, cp) * size;
      if (k) { prevAtom.width += k; prevAtom.kern = k; }
    }
    prevM = adv !== undefined ? usedM : undefined;
    // 行高：有些字体（见 MIX_GAP）要和这段文字的另一种字体（西文 / 东亚）比上伸、下伸取较大的，即使这一行没有那种字；
    // 其它字体（微软雅黑、等线、华文新魏、Arial 等）只用自己的（实测）。只管有段落标记、换行符的行，见 paragraph.ts
    const other = (usedM === latinM ? eaM : latinM)?.metrics;
    const mix = !!used && !!other && (used.lineGap > MIX_GAP || used.descent < MIX_DESC);
    const ownAsc = used?.ascent ?? 0.92, ownDesc = used?.descent ?? 0.24;
    const asc = Math.max(ownAsc, mix ? other!.ascent : 0);
    const desc = Math.max(ownDesc, mix ? other!.descent : 0);
    if (m.fontUse) {
      const requested = isSym ? style.sym! : eaFont ? style.ea : style.latin;
      m.fontUse({ requested, picked: isSym ? symFam : eaFont ? eaFam : latinFam, pickedFace: primary?.face, face: adv !== undefined ? usedM?.face : undefined, cp });
    }
    out.push({
      text: ch, cp, width, style: st, family, face: adv !== undefined ? usedM?.face : undefined,
      // 实测：上下标按缩小后的字号算上伸、下伸和行高
      ascent: asc * size,
      descent: desc * size,
      ...(mix ? { ownAscent: ownAsc * size, ownDescent: ownDesc * size } : {}),
      strikeY: (used?.strikeTop !== undefined && used.strikeSize !== undefined ? used.strikeTop - used.strikeSize / 2 : 0.25) * size,
      space: ch === ' ' || ch === '　', wide, tab: ch === '\t',
      ...shiftOf(adv !== undefined ? used?.displayShift?.(cp) : undefined, size),
    });
  }
  return out;
}
