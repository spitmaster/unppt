/**
 * 扩展点：graphicFrame（表格、图表、SmartArt、OLE……）的内容，按 a:graphicData 的 uri 分派。
 * 加一种：新建一个实现 FrameHandler 的文件，在 frames.ts 里加一行。
 * handler 只通过 FrameRenderer 使用渲染器的能力，不依赖具体的渲染器类。
 */
import type { SvgDoc } from '../../common/svg';
import type { XEl } from '../../io/xml';
import type { SlideContext } from '../../model/model';
import type { ImageResolver } from '../../style/fill';
import type { Box } from '../box';
import type { RenderEnv } from '../env';

/** handler 可以使用的渲染能力 */
export interface FrameRenderer {
  readonly env: RenderEnv;
  readonly doc: SvgDoc;
  readonly images: ImageResolver;
  /** 渲染一组子元素（SmartArt 的绘图缓存） */
  shapes(list: XEl[], ctx: SlideContext): Promise<string>;
  /** 渲染一张图片元素（OLE 的预览图） */
  picture(el: XEl, ctx: SlideContext): Promise<string>;
}

export interface FrameOutput {
  svg: string;
  /** true：svg 已经自己定位好了（不再套框的位置变换和动画标记） */
  positioned?: boolean;
}

export interface FrameHandler {
  /** a:graphicData 的 uri 结尾，例如 /table */
  readonly uri: string;
  /**
   * 返回以框左上角为原点的 SVG。uid 是这个框的动画目标编号（只有幻灯片自己的元素才有）：
   * 内部还能单独做动画的部分（SmartArt 里的形状）按它拼出子编号
   */
  render(gd: XEl, box: Box, r: FrameRenderer, ctx: SlideContext, uid?: string): Promise<FrameOutput>;
}
