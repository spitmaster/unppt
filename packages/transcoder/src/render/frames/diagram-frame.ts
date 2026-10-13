/**
 * SmartArt：用文件里 PowerPoint 存的绘图缓存（dsp:drawing）画。
 * "逐个"动画的目标是绘图里的单个形状（p:graphicEl/a:dgm 的 id 就是形状的 modelId，实测），
 * 所以每个形状单独包一层，动画编号 = 框的编号 + d + modelId（只留 32 位十六进制）
 */
import { attr, child, children } from '../../io/xml';
import { dgmUid } from '../../common/uid';
import type { SlideContext } from '../../model/model';
import type { FrameHandler } from './frame-handler';

export const diagramFrame: FrameHandler = {
  uri: '/diagram',
  async render(gd, _box, r, ctx, uid) {
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
    const kids = children(tree).filter((c) => !c.name.endsWith('nvGrpSpPr') && !c.name.endsWith('grpSpPr'));
    if (!uid) return { svg: await r.shapes(kids, sub) };
    const parts: string[] = [];
    for (const k of kids) {
      const svg = await r.shapes([k], sub);
      const id = dgmUid(uid, attr(k, 'modelId'));
      parts.push(svg && id ? `<g data-uid="${id}">${svg}</g>` : svg);
    }
    return { svg: parts.join('') };
  },
};
