/** 图表：读取关系指向的图表部件 */
import { attr, child } from '../../io/xml';
import { renderChart } from '../../chart/chart';
import type { TextWidth } from '../../chart/layout';
import { fallbackAdvance, isWide, type FontLibrary, type FontMetrics } from '../../font/font';
import type { Theme } from '../../model/model';
import type { FrameHandler } from './frame-handler';

/** 图表文字用主题字体：先把字体读好，量宽度时就能同步取真实字宽（没有字体文件时估算） */
async function chartMeasure(fonts: FontLibrary, theme: Theme): Promise<TextWidth> {
  const load = async (name: string): Promise<FontMetrics | undefined> => (name ? fonts.find(name, false, false)?.load() : undefined);
  const latin = await load(theme.minorLatin || 'Calibri');
  const ea = await load(theme.minorEa || theme.minorLatin);
  return (s, size) => {
    let w = 0;
    for (const ch of s) {
      const cp = ch.codePointAt(0)!;
      const [a, b] = isWide(cp) ? [ea, latin] : [latin, ea];
      w += a?.advance(cp) ?? b?.advance(cp) ?? fallbackAdvance(cp);
    }
    return w * size;
  };
}

export const chartFrame: FrameHandler = {
  uri: '/chart',
  async render(gd, box, r, ctx) {
    const pkg = r.env.pres.pkg;
    const rid = attr(child(gd, 'c:chart'), 'r:id');
    const rel = rid ? await pkg.rel(ctx.part, rid) : undefined;
    const xml = rel ? await pkg.xml(rel.target, false) : undefined;
    if (!xml) { r.env.pres.warn('图表数据缺失'); return { svg: '' }; }
    const measure = await chartMeasure(r.env.fonts, ctx.theme);
    return { svg: renderChart(xml, box.w, box.h, { colors: ctx.colors, theme: ctx.theme, part: rel!.target, warn: (m) => r.env.pres.warn(m), measure }) };
  },
};
