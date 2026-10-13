/** 形状（p:sp、p:cxnSp）：几何、填充、线条、效果、映像、文字 */
import type { SlideContext } from '../../model/model';
import { bgStyle, fillAttrs, findFillEl, parseFill, styleRef, type Fill } from '../../style/fill';
import { compoundMask, parseLine, strokeAttrs } from '../../style/line';
import { faceLighting, has3d, litFill } from '../../style/lighting';
import { cameraLightFilter, cameraTransform, extrusionOffset, extrusionScreenOffset, extrusionSides } from '../../style/camera';
import { EMU_PER_PX } from '../../model/model';
import { bevelLayer } from '../../effects/bevel';
import { effectFilter } from '../../effects/effect-filter';
import { reflection } from '../../effects/reflection';
import { buildGeometry, parseGeomXml, presetGeometry } from '../../geometry/geometry';
import { colorIn } from '../../model/color';
import { renderText, type TextEnv } from '../../text/text';
import { attr, child, children, numAttr, path, type XEl } from '../../io/xml';
import { flipTransform, nvProps, pc, placeBox, readXfrm, withUid } from '../box';
import type { RenderContext } from '../context';
import { projectedBounds, projectedPath, shapeProjection } from '../projection';

export async function renderShape(r: RenderContext, el: XEl, ctx: SlideContext, groupFill?: Fill): Promise<string> {
  const { layoutPh, masterPh, ph } = r.inherited(el, ctx);
  // 母版、版式上的占位符本身不显示（只提供继承属性），日期/页脚/页码除外由幻灯片自己放
  if (ph && !ctx.ownSlide) return '';
  if (attr(nvProps(el), 'hidden') === '1') return '';
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
  if (has3d(sp3d)) fill = litFill(fill, faceLighting(rig, attr(sp3d, 'prstMaterial')));
  // 线条：主题样式 -> 母版 -> 版式 -> 形状
  const lnRef = child(style, 'a:lnRef');
  const lnStyle = styleRef(lnRef, ctx.theme.lineStyles, colors);
  const line = parseLine(
    [lnStyle.el, child(mSpPr, 'a:ln'), child(lSpPr, 'a:ln'), child(spPr, 'a:ln')],
    [lnStyle.ctx, colors, colors, colors], ctx.part,
  );

  // 几何
  const geomParts: string[] = [];
  const prst = child(spPr, 'a:prstGeom') ?? child(lSpPr, 'a:prstGeom') ?? child(mSpPr, 'a:prstGeom');
  const cust = child(spPr, 'a:custGeom');
  let def = cust ? parseGeomXml(cust) : prst ? presetGeometry(attr(prst, 'prst') ?? 'rect') : presetGeometry('rect');
  if (!def) {
    r.env.pres.warn(`未支持的预设形状：${attr(prst, 'prst')}`);
    def = presetGeometry('rect')!;
  }
  const av = new Map<string, string>();
  for (const g of children(child(prst ?? cust, 'a:avLst'), 'a:gd')) av.set(attr(g, 'name') ?? '', attr(g, 'fmla') ?? '');
  const geo = buildGeometry(def, box.w, box.h, av);
  const paths = geo.paths;
  // 透视相机（自己的或 SmartArt 场景的）下轮廓逐点投影
  const sp = shapeProjection(box, scene3d, ctx.scene, r.env.pres.width);
  const projected = sp ? buildGeometry(def, box.w, box.h, av, sp.map).paths : undefined;
  // 效果：形状自己写的 > 版式 > 主题样式（effectRef）
  const effRef = styleRef(child(style, 'a:effectRef'), ctx.theme.effectStyles, colors);
  const effect = child(spPr, 'a:effectLst') ?? child(lSpPr, 'a:effectLst') ?? child(effRef.el, 'a:effectLst');
  const filter = effectFilter(effect, effect === child(effRef.el, 'a:effectLst') ? effRef.ctx : colors, r.doc, box.w, box.h, undefined, [has3d(sp3d) ? bevelLayer(sp3d) : undefined], sp && projectedBounds(sp.map, box.w, box.h));
  for (const [i, p] of paths.entries()) {
    if (!p.d) continue;
    const fa = p.fill !== 'none' ? await fillAttrs(fill, r.doc, box.w, box.h, p.fill, r.images, box) : ' fill="none"';
    const sa = p.stroke ? strokeAttrs(line, r.doc, p.fill, box) : ' stroke="none"';
    if (fa === ' fill="none"' && sa === ' stroke="none"') continue;
    const evenodd = p.d.split('M').length > 2 ? ' fill-rule="evenodd"' : '';
    if (sp && projected) {
      geomParts.push(projectedPath(projected[i].d, box, fa, sa, evenodd, sp.fillAffine, r.doc));
      continue;
    }
    // 复合线型（双线等）：描边单独画，用遮罩挖出线间空隙
    const cm = p.stroke && line ? compoundMask(line, p.d, r.doc, box) : '';
    if (cm) {
      if (fa !== ' fill="none"') geomParts.push(`<path d="${p.d}"${fa} stroke="none"${evenodd}/>`);
      geomParts.push(`<path d="${p.d}" fill="none"${sa}${cm}/>`);
    } else geomParts.push(`<path d="${p.d}"${fa}${sa}${evenodd}/>`);
  }
  let geom = geomParts.join('');
  if (geom && !sp && (box.flipH || box.flipV)) geom = `<g${flipTransform(box)}>${geom}</g>`;
  const plainGeom = geom;
  if (geom && filter) geom = `<g filter="url(#${filter})">${geom}</g>`;

  // 文字
  const uid = r.uidOf(el, ctx);
  const txBody = pc(el, 'txBody');
  const fontRef = child(style, 'a:fontRef');
  const textEnv: TextEnv = {
    colors, theme: ctx.theme, fonts: r.env.fonts, missingFonts: r.env.missingFonts,
    fontRefColor: colorIn(fontRef, colors), uid, embed: r.env.embed, doc: r.doc,
    rels: await r.env.pres.pkg.rels(ctx.part),
    images: r.images, part: ctx.part,
  };
  // SmartArt 的文字框有单独的位置（dsp:txXfrm）
  const txXfrm = readXfrm(pc(el, 'txXfrm'));
  const textBox = txXfrm ? { x: txXfrm.x - box.x, y: txXfrm.y - box.y, w: txXfrm.w, h: txXfrm.h } : geo.text;
  const text = await renderText(
    txBody, r.textChain(ctx, ph, layoutPh, masterPh),
    [path(masterPh, 'p:txBody', 'a:bodyPr'), path(layoutPh, 'p:txBody', 'a:bodyPr')],
    textBox, textEnv,
  );
  if (!geom && !text) return '';
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
  return withUid(uid, placeBox(box, lit(`${sides}${refl}${geom}${text}`), r.doc, cam), el);
}
