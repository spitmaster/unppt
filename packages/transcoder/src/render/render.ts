/**
 * 把一页幻灯片渲染成 SVG。
 * 顺序：背景 -> 母版元素 -> 版式元素 -> 幻灯片元素。占位符的属性沿 幻灯片 -> 版式 -> 母版 继承。
 */
import { colorContext, matchPlaceholder, phInfo, type Layout, type Master, type SlideContext, type SlideRef } from '../model/model';
import { bgStyle, fillAttrs, findFillEl, parseFill, styleRef, type Fill, type ImageResolver } from '../style/fill';
import { linkAttr } from '../common/links';
import { SvgDoc } from '../common/svg';
import { type StyleChain } from '../text/text';
import { attr, child, children, expandAlternate, findAll, numAttr, path, type XEl } from '../io/xml';
import { boxTransform, nvProps, pc, readXfrm, withUid } from './box';
import type { RenderEnv } from './env';
import type { RenderContext } from './context';
import { controlPictures } from './controls';
import { renderGroup } from './elements/group';
import { renderPicture } from './elements/picture';
import { renderShape } from './elements/shape';
import { FRAME_HANDLERS } from './frames/frames';

export type { RenderEnv };

export interface RenderedSlide {
  svg: string;
  colors?: import('../model/color').ColorContext;
  timing?: XEl;
  transition?: XEl;
  hidden: boolean;
  /** 组合（含嵌套的）的动画编号：颜色类动画作用在组合上不起作用 */
  groups?: Set<string>;
}

class SlideRenderer implements RenderContext {
  doc: SvgDoc;
  images: ImageResolver;

  constructor(public env: RenderEnv, public slideIndex: number) {
    this.doc = new SvgDoc(`u${slideIndex}_`);
    this.images = {
      image: (part, rid) => env.media.image(part, rid), info: (part, rid) => env.media.info(part, rid),
      keyed: (part, rid, key) => env.media.keyed(part, rid, key),
    };
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
    // 实测（text-default-style）：不是占位符的文字（文本框、形状）只用演示文稿默认样式，母版 otherStyle 不参与（表格才用它，见 table.ts）
    if (!ph) return [this.env.pres.defaultTextStyle];
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
    // 选择窗格里隐藏的对象不画
    if (attr(nvProps(el), 'hidden') === '1') return '';
    const local = el.name.slice(el.name.indexOf(':') + 1);
    let out = '';
    switch (local) {
      case 'sp': out = await this.shape(el, ctx, groupFill); break;
      case 'cxnSp': out = await this.shape(el, ctx, groupFill); break;
      case 'pic': out = await this.picture(el, ctx); break;
      case 'grpSp': out = await this.group(el, ctx, groupFill); break;
      case 'graphicFrame': out = await this.frame(el, ctx); break;
      default: return '';
    }
    // 形状上的超链接 / 动作按钮
    const h = child(nvProps(el), 'a:hlinkClick');
    if (out && h) {
      const link = linkAttr(h, await this.env.pres.pkg.rels(ctx.part));
      if (link) out = `<g${link} style="cursor:pointer">${out}</g>`;
    }
    return out;
  }

  uidOf(el: XEl, ctx: SlideContext): string | undefined {
    if (!ctx.ownSlide) return undefined;
    const id = attr(nvProps(el), 'id');
    // 只接受纯数字：编号会拼进 HTML 属性，防止恶意文件注入代码
    return id && /^\d{1,10}$/.test(id) ? `s${id}` : undefined;
  }

  shape(el: XEl, ctx: SlideContext, groupFill?: Fill): Promise<string> {
    return renderShape(this, el, ctx, groupFill);
  }

  picture(el: XEl, ctx: SlideContext): Promise<string> {
    return renderPicture(this, el, ctx);
  }

  group(el: XEl, ctx: SlideContext, parentFill?: Fill): Promise<string> {
    return renderGroup(this, el, ctx, parentFill);
  }

  async frame(el: XEl, ctx: SlideContext): Promise<string> {
    const box = readXfrm(pc(el, 'xfrm'));
    if (!box) return '';
    const gd = path(el, 'a:graphic', 'a:graphicData');
    const uri = attr(gd, 'uri') ?? '';
    const uid = this.uidOf(el, ctx);
    const handler = FRAME_HANDLERS.find((f) => uri.endsWith(f.uri));
    if (!handler || !gd) {
      this.env.pres.warn(`未支持的图形：${uri.slice(uri.lastIndexOf('/') + 1)}`);
      return '';
    }
    const out = await handler.render(gd, box, this, ctx, uid);
    if (out.positioned) return out.svg;
    return out.svg ? withUid(uid, `<g transform="${boxTransform(box)}">${out.svg}</g>`, el) : '';
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
  // 不是标准宽度的幻灯片：顶层坐标到对齐像素有缩放（DISPLAY_WIDTH）
  const s = pres.displayScale;
  const toSlide = s === 1 ? undefined : { x: 0, y: 0, sx: s, sy: s };
  const mk = (part: string, own: boolean): SlideContext => ({ pres, part, layout, master, theme, colors, ownSlide: own, slideNumber: ref.index + pres.firstSlideNum, toSlide });
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
  const tree = path(xml, 'p:cSld', 'p:spTree');
  parts.push(await r.shapes(children(tree), mk(ref.part, true)));
  parts.push(await r.shapes(controlPictures(path(xml, 'p:cSld', 'p:controls')), mk(ref.part, true)));
  const groups = new Set(findAll(tree, 'p:grpSp').map((g) => r.uidOf(g, mk(ref.part, true))).filter((u): u is string => !!u));

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${r.doc.defsXml()}${parts.join('')}</svg>`;
  return {
    svg,
    colors,
    timing: child(xml, 'p:timing'),
    transition: expandAlternate(xml.children).find((c) => c.name === 'p:transition'),
    hidden: attr(xml, 'show') === '0',
    groups,
  };
}

export type { SlideRenderer };
