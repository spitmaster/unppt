/**
 * SmartArt：用文件里 PowerPoint 存的绘图缓存（dsp:drawing）画。
 * "逐个"动画的目标是绘图里的单个形状（p:graphicEl/a:dgm 的 id 就是形状的 modelId，实测），
 * 所以每个形状单独包一层，动画编号 = 框的编号 + d + modelId（只留 32 位十六进制）
 */
import { attr, child, children } from '../../io/xml';
import { dgmUid } from '../../common/uid';
import type { SlideContext } from '../../model/model';
import type { FrameHandler } from './frame-handler';
import { cameraLightFilter, cameraTransform } from '../../style/camera';

export const diagramFrame: FrameHandler = {
  uri: '/diagram',
  async render(gd, box, r, ctx, uid) {
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
    // 三维样式：整张图是一个立体场景，相机写在快速样式（quickStyle）顶层的 dgm:scene3d 里
    const qs = attr(relIds, 'r:qs');
    const qsRel = qs ? await pkg.rel(ctx.part, qs) : undefined;
    const scene3d = qsRel ? child(await pkg.xml(qsRel.target, false), 'dgm:scene3d') : undefined;
    const sub: SlideContext = { ...ctx, part: drawingPart, ownSlide: false, ...(scene3d ? { scene: { scene3d, w: box.w, h: box.h } } : {}) };
    const kids = children(tree).filter((c) => !c.name.endsWith('nvGrpSpPr') && !c.name.endsWith('grpSpPr'));
    const cam = cameraTransform(scene3d, box.w, box.h, r.env.pres.width);
    const light = cameraLightFilter(scene3d, r.doc);
    const scene = (svg: string) => {
      const lit = light ? `<g filter="url(#${light})">${svg}</g>` : svg;
      return cam ? `<g transform="${cam}">${lit}</g>` : lit;
    };
    if (!uid) return { svg: scene(await r.shapes(kids, sub)) };
    const parts: string[] = [];
    for (const k of kids) {
      const svg = await r.shapes([k], sub);
      const id = dgmUid(uid, attr(k, 'modelId'));
      parts.push(svg && id ? `<g data-uid="${id}">${svg}</g>` : svg);
    }
    return { svg: scene(parts.join('')) };
  },
};
