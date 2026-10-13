/** SmartArt：用文件里 PowerPoint 存的绘图缓存（dsp:drawing）画 */
import { attr, child, children } from '../../io/xml';
import type { SlideContext } from '../../model/model';
import type { FrameHandler } from './frame-handler';

export const diagramFrame: FrameHandler = {
  uri: '/diagram',
  async render(gd, _box, r, ctx) {
    const relIds = child(gd, 'dgm:relIds');
    const dm = attr(relIds, 'r:dm');
    if (!dm) return { svg: '' };
    const pkg = r.env.pres.pkg;
    const dataRel = await pkg.rel(ctx.part, dm);
    if (!dataRel) return { svg: '' };
    const data = await pkg.xml(dataRel.target, false);
    let drawingPart: string | undefined;
    const ext = (data?.children ?? []).find((c) => c.name === 'dgm:extLst');
    for (const e of ext?.children ?? []) {
      const dme = e.children.find((c) => c.name === 'dsp:dataModelExt');
      const rid = attr(dme, 'relId');
      if (rid) drawingPart = (await pkg.rel(ctx.part, rid))?.target;
    }
    if (!drawingPart) {
      r.env.pres.warn('SmartArt 缺少绘图缓存');
      return { svg: '' };
    }
    const drawing = await pkg.xml(drawingPart, false);
    const tree = child(drawing, 'dsp:spTree');
    const sub: SlideContext = { ...ctx, part: drawingPart, ownSlide: false };
    return { svg: await r.shapes(children(tree).filter((c) => !c.name.endsWith('nvGrpSpPr') && !c.name.endsWith('grpSpPr')), sub) };
  },
};
