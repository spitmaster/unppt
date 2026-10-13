/** 图表：读取关系指向的图表部件 */
import { attr, child } from '../../io/xml';
import { renderChart } from '../../chart/chart';
import type { FrameHandler } from './frame-handler';

export const chartFrame: FrameHandler = {
  uri: '/chart',
  async render(gd, box, r, ctx) {
    const pkg = r.env.pres.pkg;
    const rid = attr(child(gd, 'c:chart'), 'r:id');
    const rel = rid ? await pkg.rel(ctx.part, rid) : undefined;
    const xml = rel ? await pkg.xml(rel.target, false) : undefined;
    if (!xml) { r.env.pres.warn('图表数据缺失'); return { svg: '' }; }
    return { svg: renderChart(xml, box.w, box.h, { colors: ctx.colors, theme: ctx.theme, part: rel!.target, warn: (m) => r.env.pres.warn(m) }) };
  },
};
