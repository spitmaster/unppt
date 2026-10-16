/**
 * 渲染一页时各元素渲染函数共用的能力（形状、图片、组合、graphicFrame 内容都只依赖这个接口，不依赖具体的渲染器类）。
 */
import type { SlideContext } from '../model/model';
import type { Fill } from '../style/fill';
import type { StyleChain } from '../text/text';
import type { XEl } from '../io/xml';
import type { FrameRenderer } from './frames/frame-handler';

export interface RenderContext extends FrameRenderer {
  /** 占位符继承：返回母版、版式上对应的占位符 */
  inherited(el: XEl, ctx: SlideContext): { layoutPh?: XEl; masterPh?: XEl; ph?: { type: string; idx?: string } };
  /** 文字的列表样式链（从一般到具体） */
  textChain(ctx: SlideContext, ph: { type: string } | undefined, layoutPh?: XEl, masterPh?: XEl): StyleChain;
  /** 动画目标编号（只有幻灯片自己的元素才有） */
  uidOf(el: XEl, ctx: SlideContext): string | undefined;
  shapes(list: XEl[], ctx: SlideContext, groupFill?: Fill): Promise<string>;
  /** 这一页的背景（铺满整页的元素；用幻灯片背景填充的形状要用，elements/bg-fill.ts） */
  bgSvg?: string;
}
