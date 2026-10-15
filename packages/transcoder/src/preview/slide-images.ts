/**
 * 整页图和缩略图（SPEC F1 prop.json）：每页 pic/{n}.jpg（picw × pich 取整的像素）和 thum/{n}.jpg（宽 216）。
 * 画的是这一页所有对象都显示的样子，音视频去掉（视频的封面帧本身是图片，照常显示）。
 * 每页只光栅化一次（整页图，raster.ts），缩略图由整页图区域平均缩小得到。
 */
import { encodeJpeg } from '../media/jpeg-encode';
import type { RgbaImage, Rasterizer } from './raster';
import type { WriteFn } from '../media/media';

/** 页面里图片地址 -> 图片字节（data URI、共享图片编号、media/ 下的文件） */
export type ImageBytes = (href: string) => Promise<Uint8Array | undefined>;

export const THUMB_WIDTH = 216;
const JPEG_QUALITY = 85;

export interface PreviewSize { picWidth: number; picHeight: number; thumbWidth: number; thumbHeight: number }

/** 幻灯片尺寸（像素，96 dpi）-> 整页图（磅值取整）和缩略图的像素尺寸 */
export function previewSize(slideWidth: number, slideHeight: number): PreviewSize {
  const picWidth = Math.round(slideWidth * 0.75), picHeight = Math.round(slideHeight * 0.75);
  return { picWidth, picHeight, thumbWidth: THUMB_WIDTH, thumbHeight: Math.round((THUMB_WIDTH * slideHeight) / slideWidth) };
}

export class SlideImages {
  constructor(private size: PreviewSize, private raster: Rasterizer, private bytes: ImageBytes, private write: WriteFn, private warn: (m: string) => void) {}

  /** 第 n 页（从 1 开始）；画失败时这一页不出图，记警告 */
  async add(n: number, svg: string): Promise<void> {
    let img: RgbaImage | undefined;
    try {
      img = await this.raster.render(this.page(svg), this.size.picWidth, (h) => this.bytes(unescape(h)));
    } catch (e) {
      this.warn(`整页图画不出来：${(e as Error).message}`);
    }
    if (!img) return;
    await this.write(`pic/${n}.jpg`, jpeg(img));
    await this.write(`thum/${n}.jpg`, jpeg(shrink(img, this.size.thumbWidth, this.size.thumbHeight)));
  }

  /** 页面 SVG -> 整页图大小：音视频（foreignObject 里的 video / audio）去掉；根元素的宽高换成整页图大小 */
  private page(svg: string): string {
    const { picWidth: w, picHeight: h } = this.size;
    return svg.replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject>/g, '')
      .replace(/^(<svg\b[^>]*?)\swidth="[^"]*"/, `$1 width="${w}"`).replace(/^(<svg\b[^>]*?)\sheight="[^"]*"/, `$1 height="${h}"`);
  }
}

function jpeg(img: RgbaImage): Uint8Array {
  const rgb = new Uint8Array(img.width * img.height * 3);
  for (let i = 0, j = 0; i < img.data.length; i += 4, j += 3) { rgb[j] = img.data[i]; rgb[j + 1] = img.data[i + 1]; rgb[j + 2] = img.data[i + 2]; }
  return encodeJpeg(rgb, img.width, img.height, JPEG_QUALITY);
}

/** 区域平均缩小（整页图是不透明的，不用按透明度加权） */
function shrink(img: RgbaImage, w: number, h: number): RgbaImage {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * img.height) / h), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * img.height) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * img.width) / w), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * img.width) / w));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const o = (yy * img.width + xx) * 4;
        r += img.data[o]; g += img.data[o + 1]; b += img.data[o + 2]; n++;
      }
      const o = (y * w + x) * 4;
      out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n); out[o + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}

/** 页面 SVG 里属性值的 &amp; 等还原成原文 */
function unescape(s: string) {
  return s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
