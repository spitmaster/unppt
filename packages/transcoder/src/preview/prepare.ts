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
    const out = await rewriteFonts(await inlineSvgImages(splitMorphology(flat), this.image, (key, svg, width) => this.raster(key, svg, width)), this.fonts, used);
    const faces = [...used];
    // resvg 缺字时按加载顺序找第一个有这个字的字体（不看字重），写的字体找不到时用默认字体：符号字体（Wingdings 兼容字体）排在最后、
    // 不当默认字体，否则别的字体缺的字、写了找不到的字体的文字（EMF 里的公式）会画成 Wingdings 的图形；其余的常规体在前
    const symbol = (f: FontFace) => SYMBOL_FONT.test(f.displayFamily) || SYMBOL_FONT.test(fileFamily(f));
    const ordered = [...faces.filter((f) => !symbol(f) && !f.bold && !f.italic), ...faces.filter((f) => !symbol(f) && (f.bold || f.italic)), ...faces.filter(symbol)];
    const def = ordered.find((f) => !symbol(f));
    return { svg: out, fonts: [...new Set(ordered.map((f) => this.fontId(f)))], ...(def ? { defaultFamily: fileFamily(def) } : {}) };
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

/** XML 文本里的转义还原成字（判断一个字体能不能画全这段文字用） */
const unesc = (s: string) => s.replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(+d))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&amp;/g, '&');
/** 私用区的字（原样的，或者写成十六进制转义的） */
const PUA = /&#x(?:e[0-9a-f]{3}|f[0-8][0-9a-f]{2});|[\ue000-\uf8ff]/gi;

/**
 * font-family="'甲','乙',sans-serif" 换成一个字体文件的英文名；列表里找得到的字体都记进 used。
 * resvg 不像浏览器那样按列表逐字找：缺字时找加载顺序里第一个有这个字的字体，能画整段就整段换成它画（不看字重），
 * 所以选列表里第一个能画全这段文字的字体（图表标签 "1月" 写的是 Calibri、等线，选等线），都画不全才用第一个找得到的。
 * 选定的字体画不了的私用区字（没嵌入的 Webdings、Symbol "插入符号"插的 U+F0xx 等）换成方框：否则 resvg 借用 Wingdings 兼容字体
 * 画成别的符号；观看者没有这个字体时看到的也是方框
 */
async function rewriteFonts(svg: string, fonts: FontResolver, used: Set<FontFace>): Promise<string> {
  const coverage = new Map<FontFace, Promise<(cp: number) => boolean>>();
  const draws = (f: FontFace) => {
    let p = coverage.get(f);
    if (!p) {
      p = f.load().then((m) => (cp: number) => (m.shown ? m.shown(cp) : m.advance(cp) !== undefined), () => () => false);
      coverage.set(f, p);
    }
    return p;
  };
  const parts: string[] = [];
  let last = 0;
  for (const m of svg.matchAll(/<(text|tspan)\b([^>]*)>([^<]*)/g)) {
    const [all, , attrs, content] = m;
    const fam = /\sfont-family="([^"]*)"/.exec(attrs)?.[1];
    if (!fam) continue;
    const tag = all.slice(0, all.length - content.length);
    const bold = /\sfont-weight="(bold|[6-9]00)"/.test(attrs), italic = /\sfont-style="italic"/.test(attrs);
    const names = fam.replace(/&quot;|&#39;|'/g, '').split(',').map((s) => s.trim()).filter(Boolean);
    const found = names.map((n) => fonts(n, bold, italic)).filter((f): f is FontFace => !!f);
    const cps = [...unesc(content)].map((c) => c.codePointAt(0)!).filter((cp) => cp > 0x20);
    let face: FontFace | undefined;
    for (const f of found) {
      const d = await draws(f);
      if (cps.every(d)) { face = f; break; }
    }
    face ??= found[0];
    const d = face ? await draws(face) : () => false;
    const text = content.replace(PUA, (c) => (d(unesc(c).codePointAt(0)!) ? c : '\u25a1'));
    parts.push(svg.slice(last, m.index));
    last = m.index! + all.length;
    if (!face) { parts.push(tag + text); continue; }
    for (const f of found) used.add(f);
    // 同一家族的常规 / 粗体都交给 resvg，它按 font-weight 自己挑
    const other = fonts(face.displayFamily, !bold, italic);
    if (other) used.add(other);
    let out = tag.replace(/\sfont-family="[^"]*"/, ` font-family="${fileFamily(face).replace(/"/g, '')}"`);
    // 同一个开源家族里有细体、常规体时按字重挑（微软雅黑 Light -> 思源黑体 Light）
    const w = Math.round(face.weight / 100) * 100;
    if (!bold && !/\sfont-weight=/.test(attrs) && w > 0 && w !== 400) out = out.replace(/>$/, ` font-weight="${w}">`);
    parts.push(out + text);
  }
  parts.push(svg.slice(last));
  return parts.join('');
}
