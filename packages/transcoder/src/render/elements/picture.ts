/** 图片（p:pic）：裁剪、外形、边框、效果；以及视频、音频 */
import type { SlideContext } from '../../model/model';
import { parseFill, styleRef } from '../../style/fill';
import { blipFilter } from '../../style/blip';
import { parseLine, strokeAttrs } from '../../style/line';
import { effectFilter } from '../../effects/effect-filter';
import { reflection } from '../../effects/reflection';
import { buildGeometry, parseGeomXml, presetGeometry } from '../../geometry/geometry';
import { esc, n2 } from '../../common/svg';
import { attr, child, children, numAttr, path, type XEl } from '../../io/xml';
import { boxTransform, flipTransform, nvProps, pc, readXfrm, withUid } from '../box';
import type { RenderContext } from '../context';

export async function renderPicture(r: RenderContext, el: XEl, ctx: SlideContext): Promise<string> {
  const { layoutPh, masterPh, ph } = r.inherited(el, ctx);
  if (ph && !ctx.ownSlide) return '';
  const spPr = pc(el, 'spPr');
  const box = readXfrm(child(spPr, 'a:xfrm')) ?? readXfrm(child(pc(layoutPh, 'spPr'), 'a:xfrm')) ?? readXfrm(child(pc(masterPh, 'spPr'), 'a:xfrm'));
  if (!box) return '';
  const uid = r.uidOf(el, ctx);
  const blipFill = pc(el, 'blipFill');
  const fill = parseFill(blipFill ? { ...blipFill, name: 'a:blipFill' } : undefined, ctx.colors, ctx.part);
  const parts: string[] = [];
  const mediaParts: string[] = [];
  let poster: string | undefined;
  // 图片的外形（裁剪和边框都按它画）
  const prstEl = child(spPr, 'a:prstGeom');
  const custEl = child(spPr, 'a:custGeom');
  const prst = attr(prstEl, 'prst') ?? 'rect';
  const gdef = (custEl ? parseGeomXml(custEl) : presetGeometry(prst)) ?? presetGeometry('rect')!;
  const av = new Map<string, string>();
  for (const g of children(child(prstEl ?? custEl, 'a:avLst'), 'a:gd')) av.set(attr(g, 'name') ?? '', attr(g, 'fmla') ?? '');
  const outlineD = buildGeometry(gdef, box.w, box.h, av).paths.map((p) => p.d).join('');
  if (fill && fill.kind === 'image') {
    const href = await r.images.image(ctx.part, fill.rid);
    poster = href;
    if (href) {
      const sr = fill.srcRect ?? { l: 0, t: 0, r: 0, b: 0 };
      const iw = box.w / Math.max(0.0001, 1 - sr.l - sr.r);
      const ih = box.h / Math.max(0.0001, 1 - sr.t - sr.b);
      let clip = '';
      const needsClip = prst !== 'rect' || !!custEl || sr.l !== 0 || sr.t !== 0 || sr.r !== 0 || sr.b !== 0;
      if (needsClip) {
        const id = r.doc.id('c');
        r.doc.addDef(`<clipPath id="${id}"><path d="${outlineD}"/></clipPath>`);
        clip = ` clip-path="url(#${id})"`;
      }
      const fid = blipFilter(fill.effects, r.doc);
      parts.push(`<g${clip}><image href="${esc(href)}" x="${n2(-sr.l * iw)}" y="${n2(-sr.t * ih)}" width="${n2(iw)}" height="${n2(ih)}" preserveAspectRatio="none"${fill.alpha < 1 ? ` opacity="${n2(fill.alpha)}"` : ''}${fid ? ` filter="url(#${fid})"` : ''}/></g>`);
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
  const style = pc(el, 'style');
  const lnStyle = styleRef(child(style, 'a:lnRef'), ctx.theme.lineStyles, ctx.colors);
  const line = parseLine([lnStyle.el, child(spPr, 'a:ln')], [lnStyle.ctx, ctx.colors], ctx.part);
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
  const effRef = styleRef(child(style, 'a:effectRef'), ctx.theme.effectStyles, ctx.colors);
  const effect = child(spPr, 'a:effectLst') ?? child(effRef.el, 'a:effectLst');
  const refl = visual ? reflection(child(effect, 'a:reflection'), box.h, r.doc, visual) : '';
  const filter = visual ? effectFilter(effect, effect === child(spPr, 'a:effectLst') ? ctx.colors : effRef.ctx, r.doc, box.w, box.h) : undefined;
  if (filter) visual = `<g filter="url(#${filter})">${visual}</g>`;
  let media = mediaParts.join('');
  if (media && (box.flipH || box.flipV)) media = `<g${flipTransform(box)}>${media}</g>`;
  const inner = refl + visual + media;
  // 媒体：点击切换播放（形状本身没有写点击动作时也加上）
  const clickable = mediaLink && !child(nvProps(el), 'a:hlinkClick') ? ' data-link="media" style="cursor:pointer"' : '';
  return withUid(uid, `<g${clickable} transform="${boxTransform(box)}">${inner}</g>`, el);
}
