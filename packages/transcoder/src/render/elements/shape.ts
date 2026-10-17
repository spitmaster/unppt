/** 形状（p:sp、p:cxnSp）：几何、填充、线条、效果、映像、文字 */
import type { SlideContext } from '../../model/model';
import { bgStyle, fillAttrs, findFillEl, parseFill, styleRef, type Fill } from '../../style/fill';
import { compoundMask, parseLine, strokeAttrs } from '../../style/line';
import { arrowheads } from '../../style/arrowheads';
import { faceLighting, has3d, litFill } from '../../style/lighting';
import { cameraLightFilter, cameraTransform, extrusionOffset, extrusionScreenOffset, extrusionSides, hasCamera } from '../../style/camera';
import { EMU_PER_PX } from '../../model/model';
import { n2 } from '../../common/svg';
import { bevelLayer } from '../../effects/bevel';
import { contour } from '../../effects/contour';
import { effectFilter } from '../../effects/effect-filter';
import { reflection } from '../../effects/reflection';
import { buildGeometry, parseGeomXml, presetGeometry } from '../../geometry/geometry';
import { turnedBounds } from '../../geometry/turned-bounds';
import { colorIn, css } from '../../model/color';
import { renderText, type TextEnv } from '../../text/text';
import { attr, child, children, numAttr, path, type XEl } from '../../io/xml';
import { boxTransform, flipTransform, pc, placeBox, readXfrm, withUid } from '../box';
import type { RenderContext } from '../context';
import { projectedBounds, projectedPath, shapeProjection } from '../projection';
import { pixelRow, snapBox } from '../pixel-snap';
import { backgroundFill } from './bg-fill';

export async function renderShape(r: RenderContext, el: XEl, ctx: SlideContext, groupFill?: Fill): Promise<string> {
  const { layoutPh, masterPh, ph } = r.inherited(el, ctx);
  // 母版、版式上的占位符本身不显示（只提供继承属性），日期/页脚/页码除外由幻灯片自己放
  if (ph && !ctx.ownSlide) return '';
  const spPr = pc(el, 'spPr');
  const lSpPr = pc(layoutPh, 'spPr');
  const mSpPr = pc(masterPh, 'spPr');
  const box = readXfrm(child(spPr, 'a:xfrm')) ?? readXfrm(child(lSpPr, 'a:xfrm')) ?? readXfrm(child(mSpPr, 'a:xfrm'));
  if (!box) return '';
  const style = pc(el, 'style') ?? pc(layoutPh, 'style') ?? pc(masterPh, 'style');
  const colors = ctx.colors;

  // 填充
  let fill: Fill | undefined;
  for (const sp of [spPr, lSpPr, mSpPr]) {
    fill = parseFill(findFillEl(sp), colors, ctx.part, groupFill);
    if (fill) break;
  }
  if (!fill && style) {
    const ref = styleRef(child(style, 'a:fillRef'), [], colors);
    const idx = numAttr(child(style, 'a:fillRef'), 'idx') ?? 0;
    const sEl = bgStyle(ctx.theme, idx);
    fill = parseFill(sEl, ref.ctx, ctx.theme.part);
  }
  // 三维形状（自己设的，或者主题效果样式里带的）：正面按灯光提亮
  const effStyle = styleRef(child(style, 'a:effectRef'), ctx.theme.effectStyles, colors).el;
  const sp3d = child(spPr, 'a:sp3d') ?? child(lSpPr, 'a:sp3d') ?? child(mSpPr, 'a:sp3d') ?? child(effStyle, 'a:sp3d');
  // 三维旋转、灯光（形状自己的、版式的或者主题效果样式里的 a:scene3d；SmartArt 里没写时用场景的灯光）
  const scene3d = child(spPr, 'a:scene3d') ?? child(lSpPr, 'a:scene3d') ?? child(mSpPr, 'a:scene3d') ?? child(effStyle, 'a:scene3d');
  const rig = attr(child(scene3d ?? ctx.scene?.scene3d, 'a:lightRig'), 'rig');
  if (has3d(sp3d) || hasCamera(scene3d)) fill = litFill(fill, faceLighting(rig, attr(sp3d, 'prstMaterial')));
  // 线条：主题样式 -> 母版 -> 版式 -> 形状
  const lnRef = child(style, 'a:lnRef');
  const lnStyle = styleRef(lnRef, ctx.theme.lineStyles, colors);
  const line = parseLine(
    [lnStyle.el, child(mSpPr, 'a:ln'), child(lSpPr, 'a:ln'), child(spPr, 'a:ln')],
    [lnStyle.ctx, colors, colors, colors], ctx.part, r.env.pres.displayScale,
  );

  // 几何
  const geomParts: string[] = [];
  // 实测（placeholders-inherit、placeholders-orphan）：版式里没有对应项的占位符不继承母版的形状——编号是 4294967295（"没有编号"，
  // 老格式 .ppt 转换常见）的除外，它按类型继承母版；自己、版式、母版都没写形状时不画填充和边框，只排文字
  const orphan = !!ph && !layoutPh && ph.idx !== '4294967295';
  const prst = child(spPr, 'a:prstGeom') ?? child(lSpPr, 'a:prstGeom') ?? (orphan ? undefined : child(mSpPr, 'a:prstGeom'));
  const cust = child(spPr, 'a:custGeom');
  let def = cust ? parseGeomXml(cust) : prst ? presetGeometry(attr(prst, 'prst') ?? 'rect') : presetGeometry('rect');
  if (!def) {
    r.env.pres.warn(`未支持的预设形状：${attr(prst, 'prst')}`);
    def = presetGeometry('rect')!;
  }
  const av = new Map<string, string>();
  for (const g of children(child(prst ?? cust, 'a:avLst'), 'a:gd')) av.set(attr(g, 'name') ?? '', attr(g, 'fmla') ?? '');
  // 透视相机（自己的或 SmartArt 场景的）下轮廓逐点投影
  // 三维形状离开原平面的距离（a:sp3d 的 z）：透视相机下跟着投影（样本：一摞圆环各自抬高，斜着看时上下错开）
  const sp = shapeProjection(box, scene3d, ctx.scene, r.env.pres.width, (numAttr(sp3d, 'z') ?? 0) / EMU_PER_PX);
  // 平面的形状：几何画在对齐整像素的外框里（pixel-snap.ts），文字仍按原来的框
  const snap = sp || hasCamera(scene3d) || ctx.scene ? undefined : snapBox(box, ctx.toSlide, line?.width ?? 0);
  const gb = snap ? { ...box, x: box.x + snap.dx, y: box.y + snap.dy, w: snap.w, h: snap.h } : box;
  const geo = buildGeometry(def, gb.w, gb.h, av);
  const paths = prst || cust ? geo.paths : [];
  const projected = sp ? buildGeometry(def, box.w, box.h, av, sp.map).paths : undefined;
  // 效果：形状自己写的 > 版式 > 主题样式（effectRef）
  const effRef = styleRef(child(style, 'a:effectRef'), ctx.theme.effectStyles, colors);
  const effect = child(spPr, 'a:effectLst') ?? child(lSpPr, 'a:effectLst') ?? child(effRef.el, 'a:effectLst');
  const filter = effectFilter(effect, effect === child(effRef.el, 'a:effectLst') ? effRef.ctx : colors, r.doc, gb.w, gb.h, undefined, [has3d(sp3d) ? bevelLayer(sp3d) : undefined], sp && projectedBounds(sp.map, box.w, box.h));
  // 用幻灯片背景填充（useBgFill）：按轮廓裁出整页背景垫在下面，形状本身不填充（透视、三维旋转的不管）
  const bgUse = attr(el, 'useBgFill');
  const bgLayer = (bgUse === '1' || bgUse === 'true') && r.bgSvg && !sp && !hasCamera(scene3d)
    ? backgroundFill(r.bgSvg, paths.filter((p) => p.d && p.fill !== 'none').map((p) => p.d).join(''), gb, ctx, r.env.pres.displayScale, r.doc)
    : undefined;
  if (bgLayer) fill = undefined;
  // 不跟着形状转的图片、渐变（实测样本：切掉一角的自定义形状转 45°）：正着铺在转动后轮廓的外接矩形里（不是形状框的外接矩形），
  // 也不跟着翻转（实测 fills-rot-cut）
  if ((fill?.kind === 'image' || fill?.kind === 'grad') && fill.upright && !fill.area && gb.rot && !sp) {
    const t = turnedBounds(def, gb.w, gb.h, av, gb.rot, gb.flipH, gb.flipV);
    if (t) fill = { ...fill, area: { x: gb.x + t.x, y: gb.y + t.y, w: t.w, h: t.h } };
  }
  for (const [i, p] of paths.entries()) {
    if (!p.d) continue;
    const fa = p.fill !== 'none' ? await fillAttrs(fill, r.doc, gb.w, gb.h, p.fill, r.images, gb, cust ? undefined : attr(prst, 'prst') ?? 'rect') : ' fill="none"';
    const sa = p.stroke ? strokeAttrs(line, r.doc, p.fill, gb) : ' stroke="none"';
    if (fa === ' fill="none"' && sa === ' stroke="none"') continue;
    const evenodd = p.d.split('M').length > 2 ? ' fill-rule="evenodd"' : '';
    // 线条两端的箭头：直接画成图形，线在箭头处截短（arrowheads.ts）
    const ar = p.stroke && line?.color && !sp ? arrowheads(p.d, line, css(line.color)) : undefined;
    if (ar) {
      geomParts.push(`<path d="${ar.d}"${fa}${sa}/>${ar.heads}`);
      continue;
    }
    if (sp && projected) {
      geomParts.push(projectedPath(projected[i].d, box, fa, sa, evenodd, sp.fillAffine, r.doc));
      continue;
    }
    // 复合线型（双线等）：描边单独画，用遮罩挖出线间空隙
    const cm = p.stroke && line ? compoundMask(line, p.d, r.doc, gb) : '';
    if (cm) {
      if (fa !== ' fill="none"') geomParts.push(`<path d="${p.d}"${fa} stroke="none"${evenodd}/>`);
      geomParts.push(`<path d="${p.d}" fill="none"${sa}${cm}/>`);
    } else geomParts.push(`<path d="${p.d}"${fa}${sa}${evenodd}/>`);
  }
  // 三维轮廓（contour.ts）：投影的三维形状还没做
  if (!sp) geomParts.push(contour(sp3d, colors, paths.filter((p) => p.d && p.fill !== 'none').map((p) => p.d).join(''), line?.width ?? 0, gb.w, gb.h, r.doc));
  let geom = geomParts.join('');
  if (geom && !sp && (box.flipH || box.flipV)) geom = `<g${flipTransform(gb)}>${geom}</g>`;
  const plainGeom = geom;
  if (geom && filter) geom = `<g filter="url(#${filter})">${geom}</g>`;

  // 文字
  const uid = r.uidOf(el, ctx);
  const txBody = pc(el, 'txBody');
  const fontRef = child(style, 'a:fontRef');
  const textEnv: TextEnv = {
    colors, theme: ctx.theme, fonts: r.env.fonts, missingFonts: r.env.missingFonts,
    fontRefColor: colorIn(fontRef, colors), fontRef, fontCharsets: ctx.fontCharsets, uid, embed: r.env.embed, doc: r.doc,
    rels: await r.env.pres.pkg.rels(ctx.part),
    images: r.images, part: ctx.part, slideNumber: ctx.slideNumber,
    // 外框对齐了整像素（没转动）、所在坐标系没缩放时，文字基线也对齐整像素
    ...(snap && !box.flipV ? pixelRow(ctx.toSlide, box.y, r.env.pres.displayScale) : undefined),
  };
  // SmartArt 的文字框有单独的位置（dsp:txXfrm）：在绘图坐标里按自己的外框放，转角 = 形状的 + 文字框自己的
  // （转动的形状靠文字框反向转把文字转正，例如矩阵图：形状 270°、文字框 90°）
  const txXfrm = readXfrm(pc(el, 'txXfrm'));
  const ownText = !!txXfrm && !sp;
  const textBox = txXfrm ? (ownText ? { x: 0, y: 0, w: txXfrm.w, h: txXfrm.h } : { x: txXfrm.x - box.x, y: txXfrm.y - box.y, w: txXfrm.w, h: txXfrm.h }) : snap ? buildGeometry(def, box.w, box.h, av).text : geo.text;
  const laid = await renderText(
    txBody, r.textChain(ctx, ph, layoutPh, masterPh),
    [path(masterPh, 'p:txBody', 'a:bodyPr'), path(layoutPh, 'p:txBody', 'a:bodyPr')],
    textBox, textEnv,
  );
  // 垂直翻转（包括同时水平翻转）的形状，文字绕形状中心转 180°；水平翻转时文字不变（实测）
  const textAbs = ownText && laid ? `<g transform="${boxTransform({ ...txXfrm!, rot: box.rot + txXfrm!.rot, flipH: false, flipV: false })}">${laid}</g>` : '';
  const inner = ownText ? '' : laid;
  const text = inner && box.flipV ? `<g transform="rotate(180 ${n2(box.w / 2)} ${n2(box.h / 2)})">${inner}</g>` : inner;
  if (!geom && !text && !textAbs && !bgLayer) return '';
  const cam = cameraTransform(scene3d, box.w, box.h, r.env.pres.width);
  const light = cameraLightFilter(scene3d, r.doc);
  const lit = (s: string) => (light && s ? `<g filter="url(#${light})">${s}</g>` : s);
  const depth = (numAttr(sp3d, 'extrusionH') ?? 0) / EMU_PER_PX;
  if (sp) {
    // 透视：几何已经投影到框里；拉伸侧面沿屏幕上的背面方向叠，文字用仿射近似（段落动画编号不会被复制）
    const off = depth > 0 && plainGeom ? extrusionScreenOffset(sp.camera, depth) : undefined;
    const sides = off ? extrusionSides(plainGeom, off, r.doc) : '';
    const textPart = text ? `<g transform="${sp.textAffine}">${text}</g>` : '';
    return withUid(uid, placeBox({ ...box, rot: 0 }, lit(`${sides}${geom}${textPart}`), r.doc), el);
  }
  const refl = reflection(child(effect, 'a:reflection'), box.h, r.doc, `${geom}${text}`);
  // 拉伸的侧面：按形状自己转动的视角，或者所在 SmartArt 场景的视角
  const ext = depth > 0 && plainGeom
    ? (cam ? extrusionOffset(scene3d, depth, box.w, box.h, r.env.pres.width) : ctx.scene && extrusionOffset(ctx.scene.scene3d, depth, ctx.scene.w, ctx.scene.h, r.env.pres.width))
    : undefined;
  const sides = ext ? extrusionSides(plainGeom, ext, r.doc) : '';
  const shifted = snap && geom && (snap.dx || snap.dy) ? `<g transform="translate(${n2(snap.dx)} ${n2(snap.dy)})">${geom}</g>` : geom;
  return withUid(uid, (bgLayer ?? '') + placeBox(box, lit(`${sides}${refl}${shifted}${text}`), r.doc, cam) + textAbs, el);
}
