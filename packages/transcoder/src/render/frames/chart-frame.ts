/** 图表：读取关系指向的图表部件 */
import { attr, child } from '../../io/xml';
import { renderChart, type ChartEnv } from '../../chart/chart';
import type { TextWidth } from '../../chart/layout';
import { fallbackAdvance, isWide, type FontLibrary, type FontMetrics } from '../../font/font';
import type { SlideMapping, Theme } from '../../model/model';
import { chartUid } from '../../common/uid';
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
  async render(gd, box, r, ctx, uid) {
    const pkg = r.env.pres.pkg;
    const rid = attr(child(gd, 'c:chart'), 'r:id');
    const rel = rid ? await pkg.rel(ctx.part, rid) : undefined;
    const xml = rel ? await pkg.xml(rel.target, false) : undefined;
    if (!xml) { r.env.pres.warn('图表数据缺失'); return { svg: '' }; }
    const measure = await chartMeasure(r.env.fonts, ctx.theme);
    const svg = renderChart(xml, box.w, box.h, { colors: ctx.colors, theme: ctx.theme, part: rel!.target, warn: (m) => r.env.pres.warn(m), measure, defs: { id: (k) => r.doc.id(k), add: (x) => r.doc.addDef(x) }, doc: r.doc, origin: chartOrigin(ctx.toSlide, box) });
    // 数据部分的标记换成动画编号（"按系列""按类别"动画用）；不是幻灯片自己的图表就去掉
    return { svg: svg.replace(/ data-cpart="([0-9a-z]{1,16})"/g, (_m, key: string) => (uid ? ` data-uid="${chartUid(uid, key)}"` : '')) };
  },
};

/** 图表左上角在幻灯片上的位置和缩放；在转动、翻转的组合里不知道 */
function chartOrigin(m: SlideMapping | null | undefined, box: { x: number; y: number }): ChartEnv['origin'] {
  const o = m === undefined ? { x: 0, y: 0, sx: 1, sy: 1 } : m;
  return o ? { x: o.x + o.sx * box.x, y: o.y + o.sy * box.y, sx: o.sx, sy: o.sy } : undefined;
}
