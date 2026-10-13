/** 形状（p:sp、p:cxnSp）：几何、填充、线条、效果、映像、文字 */
import type { SlideContext } from '../../model/model';
import { bgStyle, fillAttrs, findFillEl, parseFill, styleRef, type Fill } from '../../style/fill';
import { parseLine, strokeAttrs } from '../../style/line';
import { effectFilter } from '../../effects/effect-filter';
import { reflection } from '../../effects/reflection';
import { buildGeometry, parseGeomXml, presetGeometry } from '../../geometry/geometry';
import { colorIn } from '../../model/color';
import { renderText, type TextEnv } from '../../text/text';
import { attr, child, children, numAttr, path, type XEl } from '../../io/xml';
import { boxTransform, flipTransform, nvProps, pc, readXfrm, withUid } from '../box';
import type { RenderContext } from '../context';

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
  // 效果：形状自己写的 > 版式 > 主题样式（effectRef）
  const effRef = styleRef(child(style, 'a:effectRef'), ctx.theme.effectStyles, colors);
  const effect = child(spPr, 'a:effectLst') ?? child(lSpPr, 'a:effectLst') ?? child(effRef.el, 'a:effectLst');
  const filter = effectFilter(effect, effect === child(effRef.el, 'a:effectLst') ? effRef.ctx : colors, r.doc, box.w, box.h);
  for (const p of paths) {
    if (!p.d) continue;
    const fa = p.fill !== 'none' ? await fillAttrs(fill, r.doc, box.w, box.h, p.fill, r.images, box) : ' fill="none"';
    const sa = p.stroke ? strokeAttrs(line, r.doc, p.fill) : ' stroke="none"';
    if (fa === ' fill="none"' && sa === ' stroke="none"') continue;
    geomParts.push(`<path d="${p.d}"${fa}${sa}${p.d.split('M').length > 2 ? ' fill-rule="evenodd"' : ''}/>`);
  }
  let geom = geomParts.join('');
  if (geom && (box.flipH || box.flipV)) geom = `<g${flipTransform(box)}>${geom}</g>`;
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
  const refl = reflection(child(effect, 'a:reflection'), box.h, r.doc, `${geom}${text}`);
  return withUid(uid, `<g transform="${boxTransform(box)}">${refl}${geom}${text}</g>`);
}
