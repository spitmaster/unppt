/**
 * 把一页幻灯片渲染成 SVG。
 * 顺序：背景 -> 母版元素 -> 版式元素 -> 幻灯片元素。占位符的属性沿 幻灯片 -> 版式 -> 母版 继承。
 */
import { colorContext, matchPlaceholder, phInfo, EMU_PER_PX, type Layout, type Master, type Presentation, type SlideContext, type SlideRef } from './model';
import { bgStyle, blipFilter, fillAttrs, findFillEl, parseFill, parseLine, shadowFilter, strokeAttrs, styleRef, type Fill, type ImageResolver } from './fill';
import { buildGeometry, parseGeomXml, presetGeometry } from './geometry';
import { colorIn } from './color';
import type { FontLibrary } from './font';
import type { MediaStore } from './media';
import { esc, n2, SvgDoc } from './svg';
import { renderText, type FontEmbedder, type StyleChain, type TextEnv } from './text';
import { attr, boolAttr, child, children, expandAlternate, numAttr, path, type XEl } from './xml';
import { renderTable } from './table';
import { renderChart } from './chart';

export interface RenderEnv {
  pres: Presentation;
  fonts: FontLibrary;
  missingFonts: Set<string>;
  media: MediaStore;
  embed?: FontEmbedder;
}

export interface RenderedSlide {
  svg: string;
  timing?: XEl;
  transition?: XEl;
  hidden: boolean;
}

interface Box { x: number; y: number; w: number; h: number; rot: number; flipH: boolean; flipV: boolean; }

const px = (emu: number | undefined) => (emu ?? 0) / EMU_PER_PX;

/** 兼容 p: 和 dsp:（SmartArt 绘图）两种前缀的子元素查找 */
function pc(el: XEl | undefined, local: string): XEl | undefined {
  return child(el, `p:${local}`) ?? child(el, `dsp:${local}`);
}

function readXfrm(xfrm: XEl | undefined): Box | undefined {
  if (!xfrm) return undefined;
  const off = child(xfrm, 'a:off');
  const ext = child(xfrm, 'a:ext');
  if (!off && !ext) return undefined;
  return {
    x: px(numAttr(off, 'x')), y: px(numAttr(off, 'y')), w: px(numAttr(ext, 'cx')), h: px(numAttr(ext, 'cy')),
    rot: (numAttr(xfrm, 'rot') ?? 0) / 60000,
    flipH: boolAttr(xfrm, 'flipH') ?? false, flipV: boolAttr(xfrm, 'flipV') ?? false,
  };
}

function nvProps(el: XEl): XEl | undefined {
  const nv = el.children.find((c) => c.name.endsWith(':nvSpPr') || c.name.endsWith(':nvPicPr') || c.name.endsWith(':nvGrpSpPr') || c.name.endsWith(':nvCxnSpPr') || c.name.endsWith(':nvGraphicFramePr'));
  return nv?.children.find((c) => c.name.endsWith(':cNvPr'));
}

/** 动画目标外包一层不带 transform 的 g，播放器用 CSS 动画时不会覆盖元素自己的位置变换 */
function withUid(uid: string | undefined, inner: string): string {
  return uid ? `<g data-uid="${uid}">${inner}</g>` : inner;
}

function boxTransform(b: Box): string {
  let t = `translate(${n2(b.x)} ${n2(b.y)})`;
  if (b.rot) t += ` rotate(${n2(b.rot)} ${n2(b.w / 2)} ${n2(b.h / 2)})`;
  return t;
}

function flipTransform(b: Box): string {
  if (!b.flipH && !b.flipV) return '';
  return ` transform="translate(${b.flipH ? n2(b.w) : 0} ${b.flipV ? n2(b.h) : 0}) scale(${b.flipH ? -1 : 1} ${b.flipV ? -1 : 1})"`;
}

class SlideRenderer {
  doc: SvgDoc;
  images: ImageResolver;

  constructor(public env: RenderEnv, public slideIndex: number) {
    this.doc = new SvgDoc(`u${slideIndex}_`);
    this.images = { image: (part, rid) => env.media.image(part, rid) };
  }

  /** 占位符继承：返回 [母版占位符, 版式占位符]（可能为空） */
  inherited(el: XEl, ctx: SlideContext): { layoutPh?: XEl; masterPh?: XEl; ph?: { type: string; idx?: string } } {
    const ph = phInfo(el);
    if (!ph) return {};
    if (ctx.part === ctx.master.part) return { ph };
    let layoutPh: XEl | undefined;
    if (ctx.part !== ctx.layout.part) layoutPh = matchPlaceholder(ctx.layout.placeholders, ph, false);
    const lph = layoutPh ? phInfo(layoutPh) : undefined;
    const masterPh = matchPlaceholder(ctx.master.placeholders, lph ?? ph, true);
    return { layoutPh, masterPh, ph };
  }

  textChain(ctx: SlideContext, ph: { type: string } | undefined, layoutPh?: XEl, masterPh?: XEl): StyleChain {
    if (!ph) return [this.env.pres.defaultTextStyle, ctx.master.txStyles.other];
    const t = ph.type;
    const base = t === 'title' || t === 'ctrTitle' ? ctx.master.txStyles.title
      : ['dt', 'ftr', 'sldNum', 'hdr'].includes(t) ? ctx.master.txStyles.other
        : ctx.master.txStyles.body;
    return [base, path(masterPh, 'p:txBody', 'a:lstStyle'), path(layoutPh, 'p:txBody', 'a:lstStyle')];
  }

  async shapes(list: XEl[], ctx: SlideContext, groupFill?: Fill): Promise<string> {
    const out: string[] = [];
    for (const el of expandAlternate(list)) {
      try {
        out.push(await this.element(el, ctx, groupFill));
      } catch (e) {
        this.env.pres.warn(`元素渲染失败：${el.name}：${(e as Error).message}`);
      }
    }
    return out.join('');
  }

  async element(el: XEl, ctx: SlideContext, groupFill?: Fill): Promise<string> {
    const local = el.name.slice(el.name.indexOf(':') + 1);
    switch (local) {
      case 'sp': return this.shape(el, ctx, groupFill);
      case 'cxnSp': return this.shape(el, ctx, groupFill);
      case 'pic': return this.picture(el, ctx);
      case 'grpSp': return this.group(el, ctx, groupFill);
      case 'graphicFrame': return this.frame(el, ctx);
      default: return '';
    }
  }

  uidOf(el: XEl, ctx: SlideContext): string | undefined {
    if (!ctx.ownSlide) return undefined;
    const id = attr(nvProps(el), 'id');
    return id ? `s${id}` : undefined;
  }

  async shape(el: XEl, ctx: SlideContext, groupFill?: Fill): Promise<string> {
    const { layoutPh, masterPh, ph } = this.inherited(el, ctx);
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
      this.env.pres.warn(`未支持的预设形状：${attr(prst, 'prst')}`);
      def = presetGeometry('rect')!;
    }
    const av = new Map<string, string>();
    for (const g of children(child(prst ?? cust, 'a:avLst'), 'a:gd')) av.set(attr(g, 'name') ?? '', attr(g, 'fmla') ?? '');
    const geo = buildGeometry(def, box.w, box.h, av);
    const paths = geo.paths;
    const effect = child(spPr, 'a:effectLst') ?? child(lSpPr, 'a:effectLst');
    const filter = shadowFilter(effect, colors, this.doc);
    for (const p of paths) {
      if (!p.d) continue;
      const fa = p.fill !== 'none' ? await fillAttrs(fill, this.doc, box.w, box.h, p.fill, this.images) : ' fill="none"';
      const sa = p.stroke ? strokeAttrs(line, this.doc, p.fill) : ' stroke="none"';
      if (fa === ' fill="none"' && sa === ' stroke="none"') continue;
      geomParts.push(`<path d="${p.d}"${fa}${sa}${p.d.split('M').length > 2 ? ' fill-rule="evenodd"' : ''}/>`);
    }
    let geom = geomParts.join('');
    if (geom && (box.flipH || box.flipV)) geom = `<g${flipTransform(box)}>${geom}</g>`;
    if (geom && filter) geom = `<g filter="url(#${filter})">${geom}</g>`;

    // 文字
    const uid = this.uidOf(el, ctx);
    const txBody = pc(el, 'txBody');
    const fontRef = child(style, 'a:fontRef');
    const textEnv: TextEnv = {
      colors, theme: ctx.theme, fonts: this.env.fonts, missingFonts: this.env.missingFonts,
      fontRefColor: colorIn(fontRef, colors), uid, embed: this.env.embed, doc: this.doc,
    };
    // SmartArt 的文字框有单独的位置（dsp:txXfrm）
    const txXfrm = readXfrm(pc(el, 'txXfrm'));
    const textBox = txXfrm ? { x: txXfrm.x - box.x, y: txXfrm.y - box.y, w: txXfrm.w, h: txXfrm.h } : geo.text;
    const text = await renderText(
      txBody, this.textChain(ctx, ph, layoutPh, masterPh),
      [path(masterPh, 'p:txBody', 'a:bodyPr'), path(layoutPh, 'p:txBody', 'a:bodyPr')],
      textBox, textEnv,
    );
    if (!geom && !text) return '';
    return withUid(uid, `<g transform="${boxTransform(box)}">${geom}${text}</g>`);
  }

  async picture(el: XEl, ctx: SlideContext): Promise<string> {
    const { layoutPh, masterPh, ph } = this.inherited(el, ctx);
    if (ph && !ctx.ownSlide) return '';
    const spPr = pc(el, 'spPr');
    const box = readXfrm(child(spPr, 'a:xfrm')) ?? readXfrm(child(pc(layoutPh, 'spPr'), 'a:xfrm')) ?? readXfrm(child(pc(masterPh, 'spPr'), 'a:xfrm'));
    if (!box) return '';
    const uid = this.uidOf(el, ctx);
    const blipFill = pc(el, 'blipFill');
    const fill = parseFill(blipFill ? { ...blipFill, name: 'a:blipFill' } : undefined, ctx.colors, ctx.part);
    const parts: string[] = [];
    let poster: string | undefined;
    if (fill && fill.kind === 'image') {
      const href = await this.images.image(ctx.part, fill.rid);
      poster = href;
      if (href) {
        const sr = fill.srcRect ?? { l: 0, t: 0, r: 0, b: 0 };
        const iw = box.w / Math.max(0.0001, 1 - sr.l - sr.r);
        const ih = box.h / Math.max(0.0001, 1 - sr.t - sr.b);
        const prst = attr(child(spPr, 'a:prstGeom'), 'prst') ?? 'rect';
        let clip = '';
        const needsClip = prst !== 'rect' || sr.l < 0 || sr.t < 0 || sr.r < 0 || sr.b < 0 || sr.l > 0 || sr.t > 0 || sr.r > 0 || sr.b > 0;
        if (needsClip) {
          const def = presetGeometry(prst) ?? presetGeometry('rect')!;
          const id = this.doc.id('c');
          const d = buildGeometry(def, box.w, box.h).paths.map((p) => p.d).join('');
          this.doc.addDef(`<clipPath id="${id}"><path d="${d}"/></clipPath>`);
          clip = ` clip-path="url(#${id})"`;
        }
        const fid = blipFilter(fill.effects, this.doc);
        parts.push(`<g${clip}><image href="${esc(href)}" x="${n2(-sr.l * iw)}" y="${n2(-sr.t * ih)}" width="${n2(iw)}" height="${n2(ih)}" preserveAspectRatio="none"${fill.alpha < 1 ? ` opacity="${n2(fill.alpha)}"` : ''}${fid ? ` filter="url(#${fid})"` : ''}/></g>`);
      } else {
        this.env.pres.warn('图片无法显示（格式不支持或缺失）');
      }
    }
    // 视频 / 音频
    const nvPr = path(pc(el, 'nvPicPr'), 'p:nvPr');
    const video = child(nvPr, 'a:videoFile');
    const audio = child(nvPr, 'a:audioFile');
    const p14 = (path(nvPr, 'p:extLst')?.children ?? []).flatMap((e) => e.children).find((e) => e.name === 'p14:media');
    if (video || audio || p14) {
      const rid = attr(p14, 'r:embed') ?? attr(video ?? audio, 'r:link') ?? '';
      const href = rid ? await this.env.media.media(ctx.part, rid) : undefined;
      if (href) {
        const tag = audio && !video ? 'audio' : 'video';
        parts.push(`<foreignObject x="0" y="0" width="${n2(box.w)}" height="${n2(box.h)}"><${tag} xmlns="http://www.w3.org/1999/xhtml" data-media="1" src="${esc(href)}" controls="" playsinline="" preload="metadata"${poster ? ` poster="${esc(poster)}"` : ''} style="width:100%;height:100%;object-fit:contain"></${tag}></foreignObject>`);
      }
    }
    const line = parseLine([child(spPr, 'a:ln')], [ctx.colors], ctx.part);
    if (line) parts.push(`<rect width="${n2(box.w)}" height="${n2(box.h)}" fill="none"${strokeAttrs(line, this.doc, 'norm')}/>`);
    if (!parts.length) return '';
    let inner = parts.join('');
    if (box.flipH || box.flipV) inner = `<g${flipTransform(box)}>${inner}</g>`;
    return withUid(uid, `<g transform="${boxTransform(box)}">${inner}</g>`);
  }

  async group(el: XEl, ctx: SlideContext, parentFill?: Fill): Promise<string> {
    const gp = pc(el, 'grpSpPr');
    const xfrm = child(gp, 'a:xfrm');
    const box = readXfrm(xfrm);
    const chOff = child(xfrm, 'a:chOff');
    const chExt = child(xfrm, 'a:chExt');
    const groupFill = parseFill(findFillEl(gp), ctx.colors, ctx.part, parentFill) ?? parentFill;
    const kids = el.children.filter((c) => !c.name.endsWith(':nvGrpSpPr') && !c.name.endsWith(':grpSpPr'));
    const inner = await this.shapes(kids, ctx, groupFill);
    if (!inner) return '';
    const uid = this.uidOf(el, ctx);
    if (!box) return withUid(uid, inner);
    const cx = px(numAttr(chOff, 'x')), cy = px(numAttr(chOff, 'y'));
    const cw = px(numAttr(chExt, 'cx')) || box.w, ch = px(numAttr(chExt, 'cy')) || box.h;
    const sx = cw ? box.w / cw : 1, sy = ch ? box.h / ch : 1;
    let t = boxTransform(box);
    if (box.flipH || box.flipV) t += ` translate(${box.flipH ? n2(box.w) : 0} ${box.flipV ? n2(box.h) : 0}) scale(${box.flipH ? -1 : 1} ${box.flipV ? -1 : 1})`;
    t += ` scale(${sx} ${sy}) translate(${n2(-cx)} ${n2(-cy)})`;
    return withUid(uid, `<g transform="${t}">${inner}</g>`);
  }

  async frame(el: XEl, ctx: SlideContext): Promise<string> {
    const box = readXfrm(pc(el, 'xfrm'));
    if (!box) return '';
    const gd = path(el, 'a:graphic', 'a:graphicData');
    const uri = attr(gd, 'uri') ?? '';
    const uid = this.uidOf(el, ctx);
    const wrap = (inner: string) => inner ? withUid(uid, `<g transform="${boxTransform(box)}">${inner}</g>`) : "";
    if (uri.endsWith('/table')) {
      const tbl = child(gd, 'a:tbl');
      return wrap(await renderTable(tbl, box.w, box.h, this, ctx));
    }
    if (uri.endsWith('/diagram')) {
      return wrap(await this.diagram(gd, ctx));
    }
    if (uri.endsWith('/chart')) {
      const rid = attr(child(gd, 'c:chart'), 'r:id');
      const rel = rid ? await this.env.pres.pkg.rel(ctx.part, rid) : undefined;
      const xml = rel ? await this.env.pres.pkg.xml(rel.target, false) : undefined;
      if (!xml) { this.env.pres.warn('图表数据缺失'); return ''; }
      return wrap(renderChart(xml, box.w, box.h, { colors: ctx.colors, theme: ctx.theme, part: rel!.target, warn: (m) => this.env.pres.warn(m) }));
    }
    if (uri.endsWith('/ole')) {
      const ole = expandAlternate(gd?.children ?? []).find((c) => c.name === 'p:oleObj');
      const pic = child(ole, 'p:pic');
      if (pic) {
        // OLE 的预览图：位置用外框
        const clone: XEl = { ...pic, children: pic.children.map((c) => c.name === 'p:spPr' ? { ...c, children: [{ name: 'a:xfrm', attrs: {}, text: '', children: [{ name: 'a:off', attrs: { x: String(box.x * EMU_PER_PX), y: String(box.y * EMU_PER_PX) }, children: [], text: '' }, { name: 'a:ext', attrs: { cx: String(box.w * EMU_PER_PX), cy: String(box.h * EMU_PER_PX) }, children: [], text: '' }] }, ...c.children.filter((x) => x.name !== 'a:xfrm')] } : c) };
        return this.picture(clone, ctx);
      }
      this.env.pres.warn('嵌入对象（OLE）暂未支持');
      return '';
    }
    this.env.pres.warn(`未支持的图形：${uri.slice(uri.lastIndexOf('/') + 1)}`);
    return '';
  }

  async diagram(gd: XEl | undefined, ctx: SlideContext): Promise<string> {
    const relIds = child(gd, 'dgm:relIds');
    const dm = attr(relIds, 'r:dm');
    if (!dm) return '';
    const pkg = this.env.pres.pkg;
    const dataRel = await pkg.rel(ctx.part, dm);
    if (!dataRel) return '';
    const data = await pkg.xml(dataRel.target, false);
    let drawingPart: string | undefined;
    const ext = (data?.children ?? []).find((c) => c.name === 'dgm:extLst');
    for (const e of ext?.children ?? []) {
      const dme = e.children.find((c) => c.name === 'dsp:dataModelExt');
      const rid = attr(dme, 'relId');
      if (rid) drawingPart = (await pkg.rel(ctx.part, rid))?.target;
    }
    if (!drawingPart) {
      this.env.pres.warn('SmartArt 缺少绘图缓存');
      return '';
    }
    const drawing = await pkg.xml(drawingPart, false);
    const tree = child(drawing, 'dsp:spTree');
    const sub: SlideContext = { ...ctx, part: drawingPart, ownSlide: false };
    return this.shapes(children(tree).filter((c) => !c.name.endsWith('nvGrpSpPr') && !c.name.endsWith('grpSpPr')), sub);
  }

  async background(ctxs: { xml: XEl; ctx: SlideContext }[], w: number, h: number): Promise<string> {
    for (const { xml, ctx } of ctxs) {
      const bg = path(xml, 'p:cSld', 'p:bg');
      if (!bg) continue;
      const bgPr = child(bg, 'p:bgPr');
      let fill: Fill | undefined;
      if (bgPr) fill = parseFill(findFillEl(bgPr), ctx.colors, ctx.part);
      const ref = child(bg, 'p:bgRef');
      if (ref) {
        const r = styleRef(ref, [], ctx.colors);
        fill = parseFill(bgStyle(ctx.theme, numAttr(ref, 'idx') ?? 0), r.ctx, ctx.theme.part);
      }
      if (fill) return `<rect width="${w}" height="${h}"${await fillAttrs(fill, this.doc, w, h, 'norm', this.images)}/>`;
    }
    return `<rect width="${w}" height="${h}" fill="#ffffff"/>`;
  }
}

export async function renderSlide(ref: SlideRef, env: RenderEnv): Promise<RenderedSlide> {
  const { pres } = env;
  const xml = await pres.pkg.xml(ref.part, false);
  if (!xml) throw new Error('幻灯片部件缺失');
  const layoutRel = await pres.pkg.relByType(ref.part, 'slideLayout');
  const layout: Layout = await pres.layout(layoutRel?.target ?? '');
  const master: Master = layout.master;
  const theme = master.theme;
  const ovr = path(xml, 'p:clrMapOvr', 'a:overrideClrMapping');
  const clrMap = ovr ? { ...layout.clrMap, ...ovr.attrs } : layout.clrMap;
  const colors = colorContext(theme, clrMap);
  const mk = (part: string, own: boolean): SlideContext => ({ pres, part, layout, master, theme, colors, ownSlide: own });
  const r = new SlideRenderer(env, ref.index);
  const W = pres.width, H = pres.height;

  const parts: string[] = [];
  parts.push(await r.background([
    { xml, ctx: mk(ref.part, true) },
    { xml: layout.xml, ctx: mk(layout.part, false) },
    { xml: master.xml, ctx: mk(master.part, false) },
  ], W, H));
  const showMaster = attr(xml, 'showMasterSp') !== '0';
  if (showMaster && attr(layout.xml, 'showMasterSp') !== '0') {
    parts.push(await r.shapes(children(path(master.xml, 'p:cSld', 'p:spTree')), mk(master.part, false)));
  }
  if (showMaster) {
    parts.push(await r.shapes(children(path(layout.xml, 'p:cSld', 'p:spTree')), mk(layout.part, false)));
  }
  parts.push(await r.shapes(children(path(xml, 'p:cSld', 'p:spTree')), mk(ref.part, true)));

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${r.doc.defsXml()}${parts.join('')}</svg>`;
  return {
    svg,
    timing: child(xml, 'p:timing'),
    transition: expandAlternate(xml.children).find((c) => c.name === 'p:transition'),
    hidden: attr(xml, 'show') === '0',
  };
}

export type { SlideRenderer };
