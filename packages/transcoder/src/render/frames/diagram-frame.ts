/**
 * SmartArt：用文件里 PowerPoint 存的绘图缓存（dsp:drawing）画。
 * "逐个"动画的目标是绘图里的单个形状（p:graphicEl/a:dgm 的 id 就是形状的 modelId，实测），
 * 所以每个形状单独包一层，动画编号 = 框的编号 + d + modelId（只留 32 位十六进制）
 */
import { attr, child, children } from '../../io/xml';
import { dgmUid } from '../../common/uid';
import type { SlideContext } from '../../model/model';
import type { FrameHandler } from './frame-handler';
import { cameraLightFilter, cameraTransform, perspectiveProjector } from '../../style/camera';
import { fillAttrs, findFillEl, parseFill } from '../../style/fill';
import { parseLine, strokeAttrs } from '../../style/line';

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
    const sub: SlideContext = { ...ctx, part: drawingPart, ownSlide: false, diagram: true, ...(scene3d ? { scene: { scene3d, w: box.w, h: box.h } } : {}) };
    const kids = children(tree).filter((c) => !c.name.endsWith('nvGrpSpPr') && !c.name.endsWith('grpSpPr'));
    // 绘图缓存是空的（样本里见过：PowerPoint 打开时按数据模型重新排版，我们没有 SmartArt 排版引擎），和缺缓存一样提示
    if (!kids.length && (data?.children ?? []).some((c) => c.name === 'dgm:ptLst' && c.children.length > 1)) r.env.pres.warn('SmartArt 绘图缓存是空的');
    const cam = cameraTransform(scene3d, box.w, box.h, r.env.pres.width);
    const light = cameraLightFilter(scene3d, r.doc);
    // 透视的场景：每个形状自己按场景相机投影（render/projection.ts），这里不再整体变换
    const persp = !!perspectiveProjector(scene3d, box.w, box.h, r.env.pres.width);
    const scene = (svg: string) => {
      const lit = light ? `<g filter="url(#${light})">${svg}</g>` : svg;
      return cam && !persp ? `<g transform="${cam}">${lit}</g>` : lit;
    };
    // 整张图的背景和外框（数据模型的 dgm:bg、dgm:whole；样本：整张 SmartArt 垫一块青色）画在最下面
    const bgFill = parseFill(findFillEl(child(data, 'dgm:bg')), ctx.colors, dataRel.target);
    const wholeLine = parseLine([child(child(data, 'dgm:whole'), 'a:ln')], [ctx.colors], dataRel.target, r.env.pres.displayScale);
    const fa = bgFill && bgFill.kind !== 'none' ? await fillAttrs(bgFill, r.doc, box.w, box.h, 'norm', r.images) : ' fill="none"';
    const sa = wholeLine ? strokeAttrs(wholeLine, r.doc, 'norm') : ' stroke="none"';
    const back = fa !== ' fill="none"' || sa !== ' stroke="none"' ? `<rect width="${box.w}" height="${box.h}"${fa}${sa}/>` : '';
    if (!uid) return { svg: back + scene(await r.shapes(kids, sub)) };
    const parts: string[] = [];
    for (const k of kids) {
      const svg = await r.shapes([k], sub);
      const id = dgmUid(uid, attr(k, 'modelId'));
      parts.push(svg && id ? `<g data-uid="${id}">${svg}</g>` : svg);
    }
    return { svg: back + scene(parts.join('')) };
  },
};
