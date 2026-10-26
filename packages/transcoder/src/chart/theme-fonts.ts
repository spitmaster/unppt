/**
 * 图表文字里的主题字体：c:txPr、c:rich 的 a:latin / a:ea 写 +mj-lt、+mj-ea、+mn-ea 等时，和正文一样按主题解析成字体名
 * （model/theme-fonts.ts）：+mj-ea 是主题标题东亚字体，它为空时按文字语言取"汉字"等脚本字体（中文主题常见：标题东亚字体空、
 * Hans 写微软雅黑）。语言取这段文字的 lang / altLang，没写时用图表的界面语言（c:lang）。解析不出字体（语言不是中日韩、
 * 主题东亚字体又为空）的去掉，沿用图表的默认文字字体。
 * 以前 draw.ts 的 rprStyle 一律丢掉 + 开头的字体、改用次要字体：+mj-ea 的标签、标题画成了黑体 / 等线（样本：数字和汉字都是雅黑）。
 * 图表部件每次渲染都重新解析（chart-frame.ts 不缓存），这里直接改写 typeface。
 */
import { resolveTypeface } from '../model/theme-fonts';
import type { Theme } from '../model/model';
import { attr, child, type XEl } from '../io/xml';

const SLOTS = ['a:latin', 'a:ea', 'a:cs'];

export function resolveChartFonts(space: XEl, theme: Theme): void {
  const chartLang = attr(child(space, 'c:lang'), 'val') ?? 'zh-CN';
  const walk = (el: XEl) => {
    if (el.name === 'a:defRPr' || el.name === 'a:rPr' || el.name === 'a:endParaRPr') {
      const lang = attr(el, 'lang') ?? chartLang, altLang = attr(el, 'altLang');
      el.children = el.children.filter((c) => {
        const tf = SLOTS.includes(c.name) ? attr(c, 'typeface') : undefined;
        if (!tf?.startsWith('+')) return true;
        const name = resolveTypeface(tf, theme, lang, altLang);
        if (!name) return false;
        c.attrs.typeface = name;
        return true;
      });
      return;
    }
    for (const c of el.children) walk(c);
  };
  walk(space);
}
