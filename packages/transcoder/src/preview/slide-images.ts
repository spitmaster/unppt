/**
 * 整页图和缩略图（SPEC F1 prop.json）：每页 pic/{n}.jpg（picw × pich 取整的像素）和 thum/{n}.jpg（宽 216）。
 * 画的是这一页所有对象都显示的样子，音视频去掉（视频的封面帧本身是图片，照常显示）。
 * 每页先在本线程准备（prepare.ts），再交给绘制（paint.ts）：调用方给了并行出图执行器（RasterPool，例如 Node 的工作线程池
 * node-pool.ts）时交给它，多页同时画，写出仍按页码顺序；没给时在本线程一页一页画。两种画法用同一份绘制代码，结果逐字节一致。
 */
import type { WriteFn } from '../media/media';
import type { Painter, PaintJob, PaintResources, PaintResult } from './paint';
import { Preparer, type FontResolver } from './prepare';

/** 页面里图片地址 -> 图片字节（data URI、共享图片编号、media/ 下的文件） */
export type ImageBytes = (href: string) => Promise<Uint8Array | undefined>;

export const THUMB_WIDTH = 216;

export interface PreviewSize { picWidth: number; picHeight: number; thumbWidth: number; thumbHeight: number }

/** 幻灯片尺寸（像素，96 dpi）-> 整页图（磅值取整）和缩略图的像素尺寸 */
export function previewSize(slideWidth: number, slideHeight: number): PreviewSize {
  const picWidth = Math.round(slideWidth * 0.75), picHeight = Math.round(slideHeight * 0.75);
  return { picWidth, picHeight, thumbWidth: THUMB_WIDTH, thumbHeight: Math.round((THUMB_WIDTH * slideHeight) / slideWidth) };
}

/** 并行出图执行器：由调用方提供（转码器本身不创建线程，不依赖运行环境）；同时画 size 页 */
export interface RasterPool {
  readonly size: number;
  paint(job: PaintJob, resources: PaintResources): Promise<PaintResult>;
}

export class SlideImages {
  private prep: Preparer;
  /** 按页码顺序串起来的写出（画完的页等前面的页写完再写；画得慢的页不占后面页的名额） */
  private written: Promise<void> = Promise.resolve();
  /** 还在画的页 */
  private painting = new Set<Promise<unknown>>();
  /** 同时在画的页数上限：执行器的两倍（让它总有活干），本线程画时 1 */
  private limit: number;
  /**
   * 出图的警告按页码顺序攒着，flush 时一起记：警告的先后、次数和用几个线程、谁先画完无关（产物里的 report 每次一样）。
   * 背景层的警告每个背景层只记一次（每个线程各画一次背景层）
   */
  private notes: string[] = [];
  private layersNoted = new Set<string>();

  constructor(private size: PreviewSize, private painter: Painter | RasterPool, fonts: FontResolver, bytes: ImageBytes, private write: WriteFn, private warn: (m: string) => void) {
    this.prep = new Preparer(fonts, (h) => bytes(unescape(h)), Math.max(size.picWidth, size.picHeight));
    this.limit = 'size' in painter ? Math.max(1, painter.size * 2) : 1;
  }

  /** 第 n 页（从 1 开始）；画失败时这一页不出图，记警告 */
  async add(n: number, svg: string): Promise<void> {
    const { picWidth, thumbWidth, thumbHeight } = this.size;
    let job: PaintJob;
    try {
      job = await this.prep.job(n, this.page(svg), { picWidth, thumbWidth, thumbHeight });
    } catch (e) {
      const m = `整页图画不出来：${(e as Error).message}`;
      this.written = this.written.then(() => { this.notes.push(m); });
      return;
    }
    const result = this.painter.paint(job, this.prep.resources).catch((e: Error): PaintResult => ({ warnings: [`整页图画不出来：${e.message}`] }));
    this.painting.add(result);
    void result.then(() => this.painting.delete(result));
    this.written = this.written.then(async () => {
      const r = await result;
      if (job.template && r.layerWarnings && !this.layersNoted.has(job.template)) {
        this.layersNoted.add(job.template);
        this.notes.push(...r.layerWarnings);
      }
      this.notes.push(...r.warnings);
      if (r.pic) await this.write(`pic/${n}.jpg`, r.pic);
      if (r.thum) await this.write(`thum/${n}.jpg`, r.thum);
    });
    // 写失败时在 flush（本线程画时在这里）报出来；先标记成已处理，免得被 Node 当成没人管的错误
    this.written.catch(() => {});
    while (this.painting.size >= this.limit) await Promise.race(this.painting);
    // 本线程画时每页写完再画下一页（和以前的顺序一样）
    if (this.limit === 1) await this.written;
  }

  /** 等所有页画完、写完 */
  async flush(): Promise<void> {
    await this.written;
    for (const m of this.notes.splice(0)) this.warn(m);
  }

  /** 页面 SVG -> 整页图大小：音视频（foreignObject 里的 video / audio）去掉；根元素的宽高换成整页图大小 */
  private page(svg: string): string {
    const { picWidth: w, picHeight: h } = this.size;
    return svg.replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject>/g, '')
      .replace(/^(<svg\b[^>]*?)\swidth="[^"]*"/, `$1 width="${w}"`).replace(/^(<svg\b[^>]*?)\sheight="[^"]*"/, `$1 height="${h}"`);
  }
}

/** 页面 SVG 里属性值的 &amp; 等还原成原文 */
function unescape(s: string) {
  return s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
