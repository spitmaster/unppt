/**
 * 出图的"准备"一半（在主线程，要用字体库和媒体）：页面 SVG 先剔除被整页不透明图片盖住的元素（occlusion.ts），
 * 重复出现的背景拆成背景层（layers.ts），透视投影的图片换成单独画的位图（mesh-warp.ts），
 * 展开嵌套的 SVG 图片（inline-svg.ts；同一页里重复很多次的单独画成位图），
 * 字体名换成这一页实际用到的字体文件里的英文名（resvg 不认浏览器的字体回退）、发光的外扩拆成两遍（morphology.ts）——
 * 得到交给 paint.ts 画的 PaintJob。
 * 绘制要的字体、图片、背景层按编号从这里取（PaintResources）；超大图片先缩小（huge-images.ts）。
 */
import type { FontFace } from '../font/font';
import { SYMBOL_FONT } from '../font/check';
import { HUGE_PIXELS, withHugeImagesShrunk } from './huge-images';
import { splitTemplate } from './layers';
import { splitMorphology } from './morphology';
import { cullOccluded } from './occlusion';
import { inlineSvgImages } from './inline-svg';
import { warpMeshes, type MeshWarp } from './mesh-warp';
import { RASTER_PREFIX, type PaintJob, type PaintResources, type PaintSvg, type RasterSvg } from './paint';

/** 按字体名（可能是嵌入字体的别名）和粗细斜找字体文件 */
export type FontResolver = (family: string, bold: boolean, italic: boolean) => FontFace | undefined;

/** 页面里图片地址（属性原文） -> 原图字节 */
export type ImageSource = (href: string) => Promise<Uint8Array | undefined>;

let convs = 0;


/** 一次转换的出图准备（字体编号、背景层编号、超大图缩小结果都在这次转换里共用） */
export class Preparer {
  readonly conv = `c${++convs}`;
  /** 字体编号按字体文件（和集合里的偏移）给：默认字体包里很多原字体共用一个开源字体文件，只读一份、只交给 resvg 一份 */
  private fontIds = new Map<FontFace['source'], Map<number, string>>();
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

  /** side：整页图的长边（像素），长边是它 4 倍以上的 JPEG、PNG 先缩小（huge-images.ts） */
  constructor(private fonts: FontResolver, source: ImageSource, side = 0) {
    this.image = withHugeImagesShrunk(source, this.shrunk, HUGE_PIXELS, side);
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
    // 透视投影的图片先换成单独画的位图（内容在它自己的准备里处理）；先拆发光的外扩再展开嵌套的 SVG 图片：
    // 图片里的 feMorphology 有自己的缩放，不按页面的缩放改
    const flat = warpMeshes(svg, pageScale(svg), (content, width, warp) => this.raster(`mesh@${width}@${warp.dst.join(',')}@${content}`, content, width, warp));
    const out = rewriteFonts(await inlineSvgImages(splitMorphology(flat), this.image, (key, svg, width) => this.raster(key, svg, width)), this.fonts, used);
    const faces = [...used];
    // resvg 缺字时按加载顺序找第一个有这个字的字体，这个字体能画整段时整段都换成它画（不看字重）：常规体排在前面，
    // 否则页面上有粗体标题时，图表里中西文混排的标签整个画成粗体
    const regularFirst = [...faces.filter((f) => !f.bold && !f.italic), ...faces.filter((f) => f.bold || f.italic)];
    return { svg: out, fonts: [...new Set(regularFirst.map((f) => this.fontId(f)))], ...(faces[0] ? { defaultFamily: fileFamily(faces[0]) } : {}) };
  }

  /**
   * 一张要单独画成位图的 SVG（嵌套的 SVG 图片、透视投影的图片内容）：同一次转换里同一张、同样宽度的只准备一次，
   * 返回页面里引用它的地址；warp 给了时画好后按它贴成投影后的样子（mesh-warp.ts）
   */
  private raster(key: string, svg: string, width: number, warp?: MeshWarp): string {
    let id = this.rasterIds.get(key);
    if (!id) {
      id = `r${this.rasterIds.size}`;
      this.rasterIds.set(key, id);
      const p = this.prepare(svg).then((s): RasterSvg => ({ ...s, width, ...(warp ? { warp } : {}) }));
      p.catch(() => {});
      this.rasters.set(id, p);
    }
    return `${RASTER_PREFIX}${id}`;
  }

  private fontId(f: FontFace): string {
    let byOffset = this.fontIds.get(f.source);
    if (!byOffset) this.fontIds.set(f.source, (byOffset = new Map()));
    let id = byOffset.get(f.offset);
    if (!id) {
      id = `f${this.faces.size}`;
      byOffset.set(f.offset, id);
      this.faces.set(id, f);
    }
    return id;
  }
}

/** 页面的缩放：根元素的宽 / viewBox 的宽（整页图像素 / 用户单位） */
function pageScale(svg: string): number {
  const root = /^<svg\b[^>]*>/.exec(svg)?.[0] ?? '';
  const vbw = Number(/\sviewBox="[^"\d-]*-?[\d.]+[\s,]+-?[\d.]+[\s,]+([\d.]+)/.exec(root)?.[1]);
  return vbw > 0 ? (Number(/\swidth="([\d.]+)"/.exec(root)?.[1]) || vbw) / vbw : 1;
}

/**
 * 交给 resvg 的字体文件里写的家族名：默认字体包的原字体（微软雅黑等）的字形来自开源字体文件，resvg 只认文件里的名字（思源黑体），
 * 写原字体名会找不到、退回第一个加载的字体（所有字画成同一种字体）
 */
const fileFamily = (f: FontFace) => f.shownFamily ?? f.displayFamily;

/**
 * font-family="'甲','乙',sans-serif" 换成能找到的字体文件的英文名；找到的字体记进 used。
 * 找不到字体的符号字体文字（没嵌入的 Webdings、Symbol 用"插入符号"插的 U+F0xx）：resvg 会拿这一页别的字体里有这个码点的字形来画，
 * 而 Wingdings 兼容字体正好有 U+F020~F0FF，画出来是 Wingdings 的符号（错的）；这些字换成方框，和观看者没装这个字体时一样
 */
function rewriteFonts(svg: string, fonts: FontResolver, used: Set<FontFace>): string {
  return svg.replace(/<(text|tspan)\b([^>]*)>([^<]*)/g, (all, _name: string, attrs: string, content: string) => {
    const tag = all.slice(0, all.length - content.length);
    const fam = /\sfont-family="([^"]*)"/.exec(attrs)?.[1];
    if (!fam) return all;
    const bold = /\sfont-weight="(bold|[6-9]00)"/.test(attrs), italic = /\sfont-style="italic"/.test(attrs);
    const names = fam.replace(/&quot;|&#39;|'/g, '').split(',').map((s) => s.trim()).filter(Boolean);
    // 第一个找得到的字体写进 font-family；列表里其它找得到的字体也交给 resvg（图表标签 "1月" 的列表是 Calibri、等线：
    // resvg 不像浏览器那样按列表逐字找，汉字只能从加载了的字体里找替代，不加载等线就画成方框）
    const found = names.map((n) => fonts(n, bold, italic)).filter((f): f is FontFace => !!f);
    const face = found[0];
    if (!face) return SYMBOL_FONT.test(names[0] ?? '') ? tag + content.replace(/[\uf020-\uf0ff]/g, '\u25a1') : all;
    for (const f of found) used.add(f);
    // 同一家族的常规 / 粗体都交给 resvg，它按 font-weight 自己挑
    const other = fonts(face.displayFamily, !bold, italic);
    if (other) used.add(other);
    let out = tag.replace(/\sfont-family="[^"]*"/, ` font-family="${fileFamily(face).replace(/"/g, '')}"`);
    // 同一个开源家族里有细体、常规体时按字重挑（微软雅黑 Light -> 思源黑体 Light）
    const w = Math.round(face.weight / 100) * 100;
    if (!bold && !/\sfont-weight=/.test(attrs) && w > 0 && w !== 400) out = out.replace(/>$/, ` font-weight="${w}">`);
    return out + content;
  });
}
