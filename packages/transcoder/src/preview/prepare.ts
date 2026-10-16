/**
 * 出图的"准备"一半（在主线程，要用字体库和媒体）：页面 SVG 先剔除被整页不透明图片盖住的元素（occlusion.ts），
 * 重复出现的背景拆成背景层（layers.ts），展开嵌套的 SVG 图片（EMF / WMF 转出来的：resvg 画嵌套图片时不带字体，文字会丢），
 * 字体名换成这一页实际用到的字体文件里的英文名（resvg 不认浏览器的字体回退）——得到交给 paint.ts 画的 PaintJob。
 * 绘制要的字体、图片、背景层按编号从这里取（PaintResources）；超大 JPEG 先缩小（huge-images.ts）。
 */
import type { FontFace } from '../font/font';
import { withHugeImagesShrunk } from './huge-images';
import { splitTemplate } from './layers';
import { cullOccluded } from './occlusion';
import type { PaintJob, PaintResources, PaintSvg } from './paint';

/** 按字体名（可能是嵌入字体的别名）和粗细斜找字体文件 */
export type FontResolver = (family: string, bold: boolean, italic: boolean) => FontFace | undefined;

/** 页面里图片地址（属性原文） -> 原图字节 */
export type ImageSource = (href: string) => Promise<Uint8Array | undefined>;

let convs = 0;

/** 一次转换的出图准备（字体编号、背景层编号、超大图缩小结果都在这次转换里共用） */
export class Preparer {
  readonly conv = `c${++convs}`;
  private fontIds = new Map<FontFace, string>();
  private faces = new Map<string, FontFace>();
  private fontBytes = new Map<string, Promise<Uint8Array | undefined>>();
  private shrunk = new Map<string, Promise<Uint8Array | undefined>>();
  /** 出现过的背景（第二次出现才拆背景层：只出现一次的背景分开画反而多花一次叠加） */
  private seen = new Set<string>();
  private templateIds = new Map<string, string>();
  private templates = new Map<string, Promise<PaintSvg>>();
  /** 取图片字节（超大 JPEG 换成缩小后的） */
  readonly image: ImageSource;
  readonly resources: PaintResources;

  constructor(private fonts: FontResolver, source: ImageSource) {
    this.image = withHugeImagesShrunk(source, this.shrunk);
    this.resources = {
      font: (id) => {
        let p = this.fontBytes.get(id);
        if (!p) {
          const f = this.faces.get(id);
          p = f ? f.source.read(0, f.source.size).catch(() => undefined) : Promise.resolve(undefined);
          this.fontBytes.set(id, p);
        }
        return p;
      },
      image: this.image,
      template: (id) => this.templates.get(id) ?? Promise.resolve(undefined),
    };
  }

  /** 第 page 页（从 1 开始）的 SVG（根元素宽高已经是整页图大小）-> 绘制任务 */
  async job(page: number, svg: string, size: { picWidth: number; thumbWidth: number; thumbHeight: number }): Promise<PaintJob> {
    const culled = await cullOccluded(svg, this.image);
    const base = { conv: this.conv, page, ...size };
    // 背景第二次出现起：背景层单独画一次（缓存在绘制那边），之后只画本页内容再叠上去
    const split = splitTemplate(culled);
    const repeated = !!split && this.seen.has(split.key);
    if (split) this.seen.add(split.key);
    if (split && repeated) {
      let id = this.templateIds.get(split.key);
      if (!id) {
        id = `t${this.templateIds.size}`;
        this.templateIds.set(split.key, id);
        this.templates.set(id, this.prepare(split.template));
      }
      return { ...base, main: await this.prepare(split.page), template: id };
    }
    return { ...base, main: await this.prepare(culled) };
  }

  private async prepare(svg: string): Promise<PaintSvg> {
    const used = new Set<FontFace>();
    const out = rewriteFonts(await inlineSvgImages(svg, this.image), this.fonts, used);
    const faces = [...used];
    return { svg: out, fonts: faces.map((f) => this.fontId(f)), ...(faces[0] ? { defaultFamily: faces[0].displayFamily } : {}) };
  }

  private fontId(f: FontFace): string {
    let id = this.fontIds.get(f);
    if (!id) {
      id = `f${this.fontIds.size}`;
      this.fontIds.set(f, id);
      this.faces.set(id, f);
    }
    return id;
  }
}

/** font-family="'甲','乙',sans-serif" 换成能找到的字体文件的英文名；找到的字体记进 used */
function rewriteFonts(svg: string, fonts: FontResolver, used: Set<FontFace>): string {
  return svg.replace(/<(text|tspan)\b([^>]*)>/g, (tag, _name: string, attrs: string) => {
    const fam = /\sfont-family="([^"]*)"/.exec(attrs)?.[1];
    if (!fam) return tag;
    const bold = /\sfont-weight="(bold|[6-9]00)"/.test(attrs), italic = /\sfont-style="italic"/.test(attrs);
    const names = fam.replace(/&quot;|&#39;|'/g, '').split(',').map((s) => s.trim()).filter(Boolean);
    let face: FontFace | undefined;
    for (const n of names) {
      face = fonts(n, bold, italic);
      if (face) break;
    }
    if (!face) return tag;
    used.add(face);
    // 同一家族的常规 / 粗体都交给 resvg，它按 font-weight 自己挑
    const other = fonts(face.displayFamily, !bold, italic);
    if (other) used.add(other);
    return tag.replace(/\sfont-family="[^"]*"/, ` font-family="${face.displayFamily.replace(/"/g, '')}"`);
  });
}

/**
 * 嵌套的 SVG 图片（data:image/svg+xml 或者写成文件的 .svg）展开成 <g …><svg x y width height viewBox>内容</svg></g>，id 加前缀防冲突
 */
async function inlineSvgImages(svg: string, images: ImageSource): Promise<string> {
  const map = new Map<string, string>();
  let n = 0;
  for (const [tag] of svg.matchAll(/<image\b[^>]*>/g)) {
    if (map.has(tag)) continue;
    const href = /\s(?:xlink:)?href="([^"]+)"/.exec(tag)?.[1];
    if (!href) continue;
    let inner: string | undefined;
    if (href.startsWith('data:image/svg+xml;base64,')) inner = decodeBase64(href.slice(26));
    else if (/\.svg$/i.test(href)) {
      const b = await images(href);
      inner = b ? new TextDecoder().decode(b) : undefined;
    }
    const root = inner ? /^(?:<\?xml[^>]*>\s*)?<svg\b([^>]*)>([\s\S]*)<\/svg>\s*$/.exec(inner.trim()) : null;
    if (!root) continue;
    const attrs = tag.replace(/^<image\b/, '').replace(/\/?>$/, '').replace(/\s(?:xlink:)?href="[^"]*"/, '');
    const get = (k: string) => new RegExp(`\\s${k}="([^"]*)"`).exec(attrs)?.[1];
    const viewBox = /\sviewBox="([^"]*)"/.exec(root[1])?.[1];
    const par = get('preserveAspectRatio') ?? /\spreserveAspectRatio="([^"]*)"/.exec(root[1])?.[1];
    // 其余属性（transform、clip-path、opacity、filter…）放到外面的 g 上
    const rest = attrs.replace(/\s(x|y|width|height|preserveAspectRatio)="[^"]*"/g, '').trim();
    const p = `ni${n++}_`;
    const body = root[2].replace(/\sid="([^"]+)"/g, ` id="${p}$1"`).replace(/url\(#([^)]+)\)/g, `url(#${p}$1)`).replace(/(\s(?:xlink:)?href=")#([^"]+)"/g, `$1#${p}$2"`);
    const box = ['x', 'y', 'width', 'height'].map((k) => (get(k) !== undefined ? ` ${k}="${get(k)}"` : '')).join('');
    map.set(tag, `<g${rest ? ` ${rest}` : ''}><svg${box}${viewBox ? ` viewBox="${viewBox}"` : ''}${par ? ` preserveAspectRatio="${par}"` : ''}>${body}</svg></g>`);
  }
  return map.size ? svg.replace(/<image\b[^>]*>/g, (t) => map.get(t) ?? t) : svg;
}

function decodeBase64(b64: string): string {
  const s = atob(b64);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return new TextDecoder().decode(b);
}
