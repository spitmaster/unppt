/**
 * 缩略图文件夹（SPEC F1）：每页一张 JPG（thumbs/001.jpg…，有光栅化器时，见 raster.ts）或自包含的 SVG（没有时、或者这一页画失败时），
 * 和目录 thumbs/index.json。
 * 画的是这一页所有对象都显示的样子；图片缩小后内嵌（shrink.ts），音视频去掉，`<img src>` 就能显示，不再加载别的文件。
 */
import { contentHash } from '../common/hash';
import { encodeJpeg } from '../media/jpeg-encode';
import type { Rasterizer } from './raster';
import type { WriteFn } from '../media/media';
import { shrinkImage } from './shrink';

/** 页面里图片地址 -> 图片字节（data URI、共享图片编号、media/ 下的文件） */
export type ImageBytes = (href: string) => Promise<Uint8Array | undefined>;

export interface ThumbOptions { width: number; slideWidth: number; slideHeight: number }

export class Thumbnails {
  private pages: { file: string; hash: string; skip?: true }[] = [];
  private images = new Map<string, Promise<string | undefined>>();
  private readonly height: number;

  constructor(private opts: ThumbOptions, private bytes: ImageBytes, private write: WriteFn, private raster?: Rasterizer, private warn?: (m: string) => void) {
    this.height = Math.round((opts.width * opts.slideHeight) / opts.slideWidth);
  }

  /** 第 i 页（从 0 开始） */
  async add(i: number, svg: string, skip: boolean) {
    const svgThumb = await this.thumbnail(svg);
    const jpg = this.raster ? await this.jpeg(svgThumb) : undefined;
    const file = `${String(i + 1).padStart(3, '0')}.${jpg ? 'jpg' : 'svg'}`;
    const out = jpg ?? svgThumb;
    await this.write(`thumbs/${file}`, out);
    this.pages[i] = { file, hash: contentHash(out), ...(skip ? { skip: true as const } : {}) };
  }

  async finish() {
    await this.write('thumbs/index.json', JSON.stringify({ width: this.opts.width, height: this.height, pages: this.pages }, null, 1));
  }

  /** 画成像素存 JPG（质量 85）；画失败时返回 undefined，这一页退回 SVG */
  private async jpeg(svg: string): Promise<Uint8Array | undefined> {
    try {
      const img = await this.raster!.render(svg, this.opts.width, this.height);
      if (!img) return undefined;
      const rgb = new Uint8Array(img.width * img.height * 3);
      for (let i = 0, j = 0; i < img.data.length; i += 4, j += 3) { rgb[j] = img.data[i]; rgb[j + 1] = img.data[i + 1]; rgb[j + 2] = img.data[i + 2]; }
      return encodeJpeg(rgb, img.width, img.height, 85);
    } catch (e) {
      this.warn?.(`缩略图画不出来，这一页用 SVG：${(e as Error).message}`);
      return undefined;
    }
  }

  private async thumbnail(svg: string): Promise<string> {
    // 音视频（foreignObject 里的 video / audio）去掉，海报帧本身是图片照常显示
    let s = svg.replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject>/g, '');
    // 根元素的宽高换成缩略图大小（viewBox 不变，整页等比缩小）
    s = s.replace(/^(<svg\b[^>]*?)\swidth="[^"]*"/, `$1 width="${this.opts.width}"`).replace(/^(<svg\b[^>]*?)\sheight="[^"]*"/, `$1 height="${this.height}"`);
    // 图片按它在页面上的大小（<image> 的宽高，不算外面组合的缩放）换算到缩略图的 2 倍清晰度，64 像素一档，最大 2 × 缩略图宽
    const max = this.opts.width * 2;
    const map = new Map<string, string>();
    for (const [tag] of s.matchAll(/<image\b[^>]*>/g)) {
      const href = /\s(?:xlink:)?href="([^"#][^"]*)"/.exec(tag)?.[1];
      if (!href || map.has(tag)) continue;
      const shown = Math.max(attrNum(tag, 'width'), attrNum(tag, 'height'));
      const px = shown > 0 ? Math.ceil((shown * max) / this.opts.slideWidth / 64) * 64 : max;
      const uri = (await this.image(href, Math.min(max, Math.max(64, px)))) ?? 'data:,';
      map.set(tag, tag.replace(/(\s(?:xlink:)?href=")[^"]*"/, (_m, pre: string) => `${pre}${uri}"`));
    }
    return s.replace(/<image\b[^>]*>/g, (t) => map.get(t) ?? t);
  }

  /** 同一张图片缩到同一档大小的结果，所有页的缩略图共用 */
  private image(href: string, max: number): Promise<string | undefined> {
    const key = `${max}|${href}`;
    let p = this.images.get(key);
    if (!p) {
      p = this.bytes(unescape(href)).then((b) => (b ? shrinkImage(b, max) : undefined)).catch(() => undefined);
      this.images.set(key, p);
    }
    return p;
  }
}

/** 元素标签里某个数值属性（没有时是 0） */
function attrNum(tag: string, name: string): number {
  const m = new RegExp(`\\s${name}="([\\d.]+)"`).exec(tag);
  return m ? Number(m[1]) : 0;
}

/** 页面 SVG 里属性值的 &amp; 等还原成原文 */
function unescape(s: string) {
  return s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
