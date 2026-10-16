/**
 * 用幻灯片背景填充的形状（p:sp useBgFill="1"，PowerPoint 里"填充 → 幻灯片背景填充"）：形状里透出这一页的背景本身
 * （盖住下面的形状），不是样式里的填充。样本 3281 份里 69 份用到。
 * 做法：在形状所在的坐标系里按形状轮廓裁剪，画一块整页背景，按这个坐标系到幻灯片的换算（SlideContext.toSlide）摆回去。
 */
import type { SlideContext } from '../../model/model';
import { n2, type SvgDoc } from '../../common/svg';
import { boxTransform, flipTransform, type Box } from '../box';

/**
 * 形状轮廓（形状自己坐标里的路径，外框是 box）裁出来的整页背景；background 是铺满整页的背景元素，
 * scale 是 Presentation.displayScale。所在坐标系到幻灯片的换算不知道时（转动、翻转的组合里）返回 undefined
 */
export function backgroundFill(background: string, outline: string, box: Box, ctx: SlideContext, scale: number, doc: SvgDoc): string | undefined {
  if (ctx.toSlide === null || !outline) return undefined;
  // 当前坐标 X 换到幻灯片（对齐像素）是 m.x + m.sx·X，幻灯片的 SVG 坐标是对齐像素 / scale；背景按反过来的换算摆到当前坐标
  const m = ctx.toSlide ?? { x: 0, y: 0, sx: 1, sy: 1 };
  const flip = /transform="([^"]*)"/.exec(flipTransform(box))?.[1];
  const id = doc.id('c');
  doc.addDef(`<clipPath id="${id}"><path d="${outline}" transform="${boxTransform(box)}${flip ? ` ${flip}` : ''}"/></clipPath>`);
  return `<g clip-path="url(#${id})"><g transform="matrix(${n2(scale / m.sx)} 0 0 ${n2(scale / m.sy)} ${n2(-m.x / m.sx)} ${n2(-m.y / m.sy)})">${background}</g></g>`;
}
