/** 图表：读取关系指向的图表部件 */
import { attr, child, findAll, type XEl } from '../../io/xml';
import { renderChart, type ChartEnv } from '../../chart/chart';
import type { TextWidth } from '../../chart/layout';
import { fallbackAdvance, isWide, type FontLibrary, type FontMetrics } from '../../font/font';
import type { SlideMapping, Theme } from '../../model/model';
import { chartUid } from '../../common/uid';
import type { FrameHandler } from './frame-handler';

/**
 * 图表文字的宽度：按文字自己的字体（图表里写的字体先全部读好，量宽度时同步取真实字宽），没写字体的按主题字体；
 * 字体里没有的字用主题字体，都没有时估算（样本：分类标签用 Arial Narrow，按主题字体量宽了，绘图区整体右移）
 */
async function chartMeasure(fonts: FontLibrary, theme: Theme, xml: XEl): Promise<TextWidth> {
  const load = async (name: string): Promise<FontMetrics | undefined> => (name ? fonts.find(name, false, false)?.load() : undefined);
  const latin = await load(theme.minorLatin || 'Calibri');
  const ea = await load(theme.minorEa || theme.minorLatin);
  const own = new Map<string, FontMetrics | undefined>();
  for (const el of [...findAll(xml, 'a:latin'), ...findAll(xml, 'a:ea')]) {
    const name = attr(el, 'typeface');
    if (name && !name.startsWith('+') && !own.has(name)) own.set(name, await load(name));
  }
  return (s, size, font) => {
    const f = font ? own.get(font) : undefined;
    let w = 0;
    for (const ch of s) {
      const cp = ch.codePointAt(0)!;
      const [a, b] = isWide(cp) ? [ea, latin] : [latin, ea];
      w += f?.advance(cp) ?? a?.advance(cp) ?? b?.advance(cp) ?? fallbackAdvance(cp);
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
    // 图表自己带的主题（themeOverride，从别的文件复制来的图表常有；样本：Office 2007 配色）：自动配色、主题字体按它
    const ov = await pkg.relByType(rel!.target, 'themeOverride');
    const theme = ov ? overrideTheme(ctx.theme, await r.env.pres.theme(ov.target)) : ctx.theme;
    const colors = ov ? { ...ctx.colors, scheme: theme.colors } : ctx.colors;
    const measure = await chartMeasure(r.env.fonts, theme, xml);
    const svg = renderChart(xml, box.w, box.h, { colors, theme, part: rel!.target, warn: (m) => r.env.pres.warn(m), measure, defs: { id: (k) => r.doc.id(k), add: (x) => r.doc.addDef(x) }, doc: r.doc, origin: chartOrigin(ctx.toSlide, box) });
    // 数据部分的标记换成动画编号（"按系列""按类别"动画用）；不是幻灯片自己的图表就去掉
    return { svg: svg.replace(/ data-cpart="([0-9a-z]{1,16})"/g, (_m, key: string) => (uid ? ` data-uid="${chartUid(uid, key)}"` : '')) };
  },
};

/** 主题覆盖里写了的部分盖过页面的主题（配色、字体、样式列表各自没写时用页面的） */
function overrideTheme(base: Theme, ov: Theme): Theme {
  return {
    ...base,
    colors: Object.keys(ov.colors).length ? ov.colors : base.colors,
    ...(ov.minorLatin || ov.majorLatin ? {
      majorLatin: ov.majorLatin, minorLatin: ov.minorLatin, majorEa: ov.majorEa, minorEa: ov.minorEa,
      majorScripts: ov.majorScripts, minorScripts: ov.minorScripts, majorEaOwn: ov.majorEaOwn, minorEaOwn: ov.minorEaOwn,
    } : {}),
    fillStyles: ov.fillStyles.length ? ov.fillStyles : base.fillStyles,
    lineStyles: ov.lineStyles.length ? ov.lineStyles : base.lineStyles,
    effectStyles: ov.effectStyles.length ? ov.effectStyles : base.effectStyles,
    bgFillStyles: ov.bgFillStyles.length ? ov.bgFillStyles : base.bgFillStyles,
  };
}

/** 图表左上角在幻灯片上的位置和缩放；在转动、翻转的组合里不知道 */
function chartOrigin(m: SlideMapping | null | undefined, box: { x: number; y: number }): ChartEnv['origin'] {
  const o = m === undefined ? { x: 0, y: 0, sx: 1, sy: 1 } : m;
  return o ? { x: o.x + o.sx * box.x, y: o.y + o.sy * box.y, sx: o.sx, sy: o.sy } : undefined;
}
