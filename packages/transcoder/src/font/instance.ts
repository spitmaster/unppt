/**
 * 可变字体的实例：PowerPoint 用本机装的可变字体时，常规用 Regular 实例、粗体用 Bold 实例（实测见 fvar.ts instanceWeight），
 * 不用字体文件的默认实例（Windows 自带的 Noto Sans SC 默认是 Thin）。这里用 hb-subset 把轴固定在要的位置，得到一个普通字体，
 * 排版的字宽、嵌入产物的子集、出图交给 resvg 的字体都用它。第一次用到（load）时才做；做不了（字体太大，见 subset.ts instanceFont）
 * 时标成 unusable、不给字形，按缺字体处理——不悄悄用默认实例
 */
import { loadFontFile, type FontFace, type FontMetrics } from './font';
import { instanceFont } from './subset';

/** 取不了实例时的度量：一个字都没有 */
const NO_GLYPHS: FontMetrics = {
  unitsPerEm: 1000, ascent: 0.92, descent: 0.24, lineGap: 0,
  advance: () => undefined, kern: () => 0, outline: async () => undefined,
};

/** 可变字体 vf 在字重 wght（undefined：没有字重轴，各轴都取默认值）的实例；load() 之前 source 仍是可变字体文件 */
export function variableInstance(vf: FontFace, wght: number | undefined): FontFace {
  let loaded: Promise<FontMetrics> | undefined;
  const weight = wght ?? vf.weight;
  const face: FontFace = {
    families: vf.families, displayFamily: vf.displayFamily, italic: vf.italic, rank: vf.rank, shownFamily: vf.shownFamily,
    bold: wght === undefined ? vf.bold : weight >= 600, weight, source: vf.source, offset: vf.offset,
    load() {
      loaded ??= (async () => {
        const bytes = await instanceFont(vf.source, vf.offset, wght).catch(() => undefined);
        const real = bytes ? (await loadFontFile(bytes))[0] : undefined;
        if (!real) { face.unusable = true; return NO_GLYPHS; }
        face.source = real.source;
        face.offset = real.offset;
        return real.load();
      })();
      return loaded;
    },
  };
  return face;
}
