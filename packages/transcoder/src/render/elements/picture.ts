/** 图片（p:pic）：裁剪、外形、边框、效果；以及视频、音频 */
import type { SlideContext } from '../../model/model';
import { blipImage, imagePlacement, parseFill, styleRef } from '../../style/fill';
import { parseLine, strokeAttrs } from '../../style/line';
import { effectFilter } from '../../effects/effect-filter';
import { reflection } from '../../effects/reflection';
import { buildGeometry, parseGeomXml, presetGeometry } from '../../geometry/geometry';
import { esc, n2 } from '../../common/svg';
import { attr, child, children, numAttr, path, type XEl } from '../../io/xml';
import { flipTransform, nvProps, pc, placeBox, readXfrm, withUid } from '../box';
import { snapBox } from '../pixel-snap';
import { cameraLightTransfer, cameraTransform, hasCamera } from '../../style/camera';
import { faceLightTransfer, has3d, lightFilter } from '../../style/lighting';
import { baseProjection, projectedBounds } from '../projection';
import type { RenderContext } from '../context';

export async function renderPicture(r: RenderContext, el: XEl, ctx: SlideContext): Promise<string> {
  const { layoutPh, masterPh, ph } = r.inherited(el, ctx);
  if (ph && !ctx.ownSlide) return '';
  const spPr = pc(el, 'spPr');
  const raw = readXfrm(child(spPr, 'a:xfrm')) ?? readXfrm(child(pc(layoutPh, 'spPr'), 'a:xfrm')) ?? readXfrm(child(pc(masterPh, 'spPr'), 'a:xfrm'));
  if (!raw) return '';
  const style = pc(el, 'style');
  const effRef = styleRef(child(style, 'a:effectRef'), ctx.theme.effectStyles, ctx.colors);
  const scene3d = child(spPr, 'a:scene3d') ?? child(effRef.el, 'a:scene3d');
  // 平面的图片：外框四边对齐整像素（pixel-snap.ts；边框画在图片外侧，整像素宽的边框也正好是实线）
  const sb = hasCamera(scene3d) || ctx.scene ? undefined : snapBox(raw, ctx.toSlide, 0);
  const box = sb ? { ...raw, x: raw.x + sb.dx, y: raw.y + sb.dy, w: sb.w, h: sb.h } : raw;
  const uid = r.uidOf(el, ctx);
  const blipFill = pc(el, 'blipFill');
  const fill = parseFill(blipFill ? { ...blipFill, name: 'a:blipFill' } : undefined, ctx.colors, ctx.part);
  const parts: string[] = [];
  const mediaParts: string[] = [];
  let poster: string | undefined;
  // 图片的外形（裁剪和边框都按它画）：自己没写时按版式、母版里对应占位符的
  // 实测（placeholders-picture、placeholders-picture-geom）：继承链上哪里都没写形状的图片 PowerPoint 不画
  // （占位符继承到母版正文占位符的矩形时照常画；版式占位符是自定义形状时按它裁剪）
  const geomSp = [spPr, pc(layoutPh, 'spPr'), pc(masterPh, 'spPr')].find((s) => child(s, 'a:prstGeom') || child(s, 'a:custGeom'));
  const prstEl = child(geomSp, 'a:prstGeom');
  const custEl = child(geomSp, 'a:custGeom');
  if (!prstEl && !custEl) return '';
  const prst = attr(prstEl, 'prst') ?? 'rect';
  const gdef = (custEl ? parseGeomXml(custEl) : presetGeometry(prst)) ?? presetGeometry('rect')!;
  const av = new Map<string, string>();
  for (const g of children(child(prstEl ?? custEl, 'a:avLst'), 'a:gd')) av.set(attr(g, 'name') ?? '', attr(g, 'fmla') ?? '');
  const outlineD = buildGeometry(gdef, box.w, box.h, av).paths.map((p) => p.d).join('');
  if (fill && fill.kind === 'image') {
    const { href, filter: fid } = await blipImage(r.images, ctx.part, fill.rid, fill.effects, r.doc);
    poster = href;
    if (href) {
      const sr = fill.srcRect ?? { l: 0, t: 0, r: 0, b: 0 };
      const fr = fill.fillRect;
      const { x: ix, y: iy, iw, ih } = imagePlacement(fill, box.w, box.h);
      let clip = '';
      // 水平翻转、整个在幻灯片里的图片，PowerPoint 画出的内容比镜像的位置往右多 1 像素（右边缘多出的裁掉，边框不动；
      // 垂直翻转、伸出幻灯片的没有，实测）
      const flipShift = box.flipH && onSlide(box, ctx, r.env.pres) ? ` transform="translate(${n2(-1 / r.env.pres.displayScale)} 0)"` : '';
      const needsClip = prst !== 'rect' || !!custEl || sr.l !== 0 || sr.t !== 0 || sr.r !== 0 || sr.b !== 0 || !!fr || !!flipShift;
      if (needsClip) {
        const id = r.doc.id('c');
        r.doc.addDef(`<clipPath id="${id}"><path d="${outlineD}"/></clipPath>`);
        clip = ` clip-path="url(#${id})"`;
      }
      parts.push(`<g${clip}><image${flipShift} href="${esc(href)}" x="${n2(ix)}" y="${n2(iy)}" width="${n2(iw)}" height="${n2(ih)}" preserveAspectRatio="none"${fill.alpha < 1 ? ` opacity="${n2(fill.alpha)}"` : ''}${fid ? ` filter="url(#${fid})"` : ''}/></g>`);
    } else {
      r.env.pres.warn('图片无法显示（格式不支持或缺失）');
    }
  }
  // 视频 / 音频
  let mediaLink = false;
  const nvPr = path(pc(el, 'nvPicPr'), 'p:nvPr');
  const video = child(nvPr, 'a:videoFile');
  const audio = child(nvPr, 'a:audioFile');
  const p14 = (path(nvPr, 'p:extLst')?.children ?? []).flatMap((e) => e.children).find((e) => e.name === 'p14:media');
  // 剪裁（毫秒）：st 从开头剪掉、end 从结尾剪掉；写成秒交给播放器
  const trimEl = child(p14, 'p14:trim');
  const trimSt = (numAttr(trimEl, 'st') ?? 0) / 1000, trimEnd = (numAttr(trimEl, 'end') ?? 0) / 1000;
  // 淡入、淡出（毫秒）：播放器按播放位置调音量
  const fadeEl = child(p14, 'p14:fade');
  const fadeIn = (numAttr(fadeEl, 'in') ?? 0) / 1000, fadeOut = (numAttr(fadeEl, 'out') ?? 0) / 1000;
  const trim = `${trimSt > 0 ? ` data-trim-start="${n2(trimSt)}"` : ''}${trimEnd > 0 ? ` data-trim-end="${n2(trimEnd)}"` : ''}`
    + `${fadeIn > 0 ? ` data-fade-in="${n2(fadeIn)}"` : ''}${fadeOut > 0 ? ` data-fade-out="${n2(fadeOut)}"` : ''}`;
  if (video || audio || p14) {
    const rid = attr(p14, 'r:embed') ?? attr(video ?? audio, 'r:link') ?? '';
    const href = rid ? await r.env.media.media(ctx.part, rid) : undefined;
    if (href) {
      const isAudio = !!audio && !video;
      if (isAudio) {
        // 音频：显示 PowerPoint 的图标，音频元素本身不显示，由时间线或点击图标控制播放
        mediaParts.push(`<foreignObject x="0" y="0" width="1" height="1"><audio xmlns="http://www.w3.org/1999/xhtml" data-media="1"${trim} src="${esc(href)}" preload="metadata" style="display:none"></audio></foreignObject>`);
      } else {
        // 视频：显示封面帧，不用浏览器自带控件，点击播放/暂停
        mediaParts.push(`<foreignObject x="0" y="0" width="${n2(box.w)}" height="${n2(box.h)}"><video xmlns="http://www.w3.org/1999/xhtml" data-media="1"${trim} src="${esc(href)}" playsinline="" preload="metadata"${poster ? ` poster="${esc(poster)}"` : ''} style="width:100%;height:100%;object-fit:fill"></video></foreignObject>`);
      }
      mediaLink = true;
    }
  }
  const lnStyle = styleRef(child(style, 'a:lnRef'), ctx.theme.lineStyles, ctx.colors);
  const line = parseLine([lnStyle.el, child(spPr, 'a:ln')], [lnStyle.ctx, ctx.colors], ctx.part, r.env.pres.displayScale);
  if (line) {
    // 实测：图片的边框整个画在图片外侧（按线宽外扩半个线宽再描边），不压住图片
    const lw = line.width;
    const d = buildGeometry(gdef, box.w + lw, box.h + lw, av).paths.map((p) => p.d).join('');
    parts.push(`<path d="${d}" transform="translate(${n2(-lw / 2)} ${n2(-lw / 2)})" fill="none"${strokeAttrs(line, r.doc, 'norm')}/>`);
  }
  if (!parts.length && !mediaParts.length) return '';
  let visual = parts.join('');
  if (visual && (box.flipH || box.flipV)) visual = `<g${flipTransform(box)}>${visual}</g>`;
  // 效果（图片样式常见：映像、柔化边缘、阴影、发光）：图片自己写的 > 主题样式
  const effect = child(spPr, 'a:effectLst') ?? child(effRef.el, 'a:effectLst');
  const refl = visual ? reflection(child(effect, 'a:reflection'), box.h, r.doc, visual) : '';
  // 透视（自己的相机，或者所在 SmartArt 场景的）：图片按网格三角形画，阴影、发光等效果在投影以后对整张图做（和形状一样）——
  // 每个三角形各带一份效果时，半透明的阴影在三角形重叠处叠深，露出网格接缝
  const proj = baseProjection(box, scene3d, ctx.scene, r.env.pres.width)?.base;
  const filter = visual ? effectFilter(effect, effect === child(spPr, 'a:effectLst') ? ctx.colors : effRef.ctx, r.doc, box.w, box.h, undefined, undefined, proj && projectedBounds(proj, box.w, box.h)) : undefined;
  if (filter && !proj) visual = `<g filter="url(#${filter})">${visual}</g>`;
  let media = mediaParts.join('');
  if (media && (box.flipH || box.flipV)) media = `<g${flipTransform(box)}>${media}</g>`;
  const inner = refl + visual + media;
  // 媒体：点击切换播放（形状本身没有写点击动作时也加上）
  const clickable = mediaLink && !child(nvProps(el), 'a:hlinkClick') ? ' data-link="media" style="cursor:pointer"' : '';
  // 三维旋转（图片样式常见的"透视""旋转"）
  const cam = cameraTransform(scene3d, box.w, box.h, r.env.pres.width);
  const light = cameraLightTransfer(scene3d);
  // 开了三维（相机或棱台）的图片和形状一样，正面按灯光提亮（实测：透视正面下灰 128 -> 139）
  const sp3d = child(spPr, 'a:sp3d') ?? child(effRef.el, 'a:sp3d');
  const lit3d = hasCamera(scene3d) || has3d(sp3d) ? faceLightTransfer(attr(child(scene3d, 'a:lightRig'), 'rig'), attr(sp3d, 'prstMaterial')) : undefined;

  // 正面光照、转动后的明暗合成一个滤镜（分两层套，Chrome 会把里面的阴影画丢）
  const lf = lightFilter(r.doc, [lit3d, light]);
  const attrs = clickable + (filter && proj ? ` filter="url(#${filter})"` : '');
  return withUid(uid, placeBox(box, lf ? `<g filter="url(#${lf})">${inner}</g>` : inner, r.doc, cam, proj, attrs), el);
}

/** 图片整个在幻灯片范围里（坐标系换算不知道时按不在算；toSlide 换算到的是对齐像素） */
function onSlide(box: { x: number; y: number; w: number; h: number }, ctx: SlideContext, pres: { width: number; height: number; displayScale: number }): boolean {
  const m = ctx.toSlide === undefined ? { x: 0, y: 0, sx: 1, sy: 1 } : ctx.toSlide;
  if (!m) return false;
  const x0 = m.x + m.sx * box.x, x1 = m.x + m.sx * (box.x + box.w), y0 = m.y + m.sy * box.y, y1 = m.y + m.sy * (box.y + box.h);
  const W = pres.width * pres.displayScale, H = pres.height * pres.displayScale;
  return Math.min(x0, x1) >= 0 && Math.min(y0, y1) >= 0 && Math.max(x0, x1) <= W && Math.max(y0, y1) <= H;
}
