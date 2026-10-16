/**
 * 出图的"准备"一半（在主线程，要用字体库和媒体）：页面 SVG 先剔除被整页不透明图片盖住的元素（occlusion.ts），
 * 重复出现的背景拆成背景层（layers.ts），展开嵌套的 SVG 图片（inline-svg.ts；同一页里重复很多次的单独画成位图），
 * 字体名换成这一页实际用到的字体文件里的英文名（resvg 不认浏览器的字体回退）、发光的外扩拆成两遍（morphology.ts）——
 * 得到交给 paint.ts 画的 PaintJob。
 * 绘制要的字体、图片、背景层按编号从这里取（PaintResources）；超大 JPEG 先缩小（huge-images.ts）。
 */
import type { FontFace } from '../font/font';
import { withHugeImagesShrunk } from './huge-images';
import { splitTemplate } from './layers';
import { splitMorphology } from './morphology';
import { cullOccluded } from './occlusion';
import { inlineSvgImages } from './inline-svg';
import { RASTER_PREFIX, type PaintJob, type PaintResources, type PaintSvg, type RasterSvg } from './paint';

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
  /** 单独画成位图的 SVG 图片（inline-svg.ts）：图片地址@宽度 -> 编号，编号 -> 准备好的 SVG */
  private rasterIds = new Map<string, string>();
  private rasters = new Map<string, Promise<RasterSvg>>();
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
      raster: (id) => this.rasters.get(id) ?? Promise.resolve(undefined),
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
        const t = this.prepare(split.template);
        // 准备失败时由向它要背景层的绘制报出来；先标记成已处理，免得没人要时被 Node 当成没人管的错误
        t.catch(() => {});
        this.templates.set(id, t);
      }
      return { ...base, main: await this.prepare(split.page), template: id };
    }
    return { ...base, main: await this.prepare(culled) };
  }

  private async prepare(svg: string): Promise<PaintSvg> {
    const used = new Set<FontFace>();
    // 先拆发光的外扩再展开嵌套的 SVG 图片：图片里的 feMorphology 有自己的缩放，不按页面的缩放改
    const out = rewriteFonts(await inlineSvgImages(splitMorphology(svg), this.image, (key, svg, width) => this.raster(key, svg, width)), this.fonts, used);
    const faces = [...used];
    return { svg: out, fonts: faces.map((f) => this.fontId(f)), ...(faces[0] ? { defaultFamily: faces[0].displayFamily } : {}) };
  }

  /** 一张要单独画成位图的 SVG 图片：同一次转换里同一张、同样宽度的只准备一次，返回页面里引用它的地址 */
  private raster(key: string, svg: string, width: number): string {
    let id = this.rasterIds.get(key);
    if (!id) {
      id = `r${this.rasterIds.size}`;
      this.rasterIds.set(key, id);
      const p = this.prepare(svg).then((s): RasterSvg => ({ ...s, width }));
      p.catch(() => {});
      this.rasters.set(id, p);
    }
    return `${RASTER_PREFIX}${id}`;
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
