/**
 * 把形状的 a:effectLst 组合成一个 SVG filter：under 层在下，形状本身（可能被 source 层替换）居中，over 层在上。
 */
import type { ColorContext } from '../model/color';
import { n2, type SvgDoc } from '../common/svg';
import { child, type XEl } from '../io/xml';
import { SHAPE_EFFECTS } from './effects';
import type { ShapeEffect } from './shape-effect';

/** w/h 是形状尺寸（像素），用来确定滤镜区域；返回 filter id，没有效果时返回 undefined */
export function effectFilter(
  effectLst: XEl | undefined, colors: ColorContext, doc: SvgDoc, w: number, h: number,
  effects: readonly ShapeEffect[] = SHAPE_EFFECTS,
): string | undefined {
  if (!effectLst) return undefined;
  const parts: string[] = [];
  const under: string[] = [];
  const over: string[] = [];
  let src = 'SourceGraphic';
  let pad = 0;
  for (const effect of effects) {
    const el = child(effectLst, effect.tag);
    const layer = el && effect.build(el, colors);
    if (!layer) continue;
    parts.push(layer.primitives);
    pad = Math.max(pad, layer.extent);
    if (layer.place === 'under') under.push(layer.result);
    else if (layer.place === 'over') over.push(layer.result);
    else src = layer.result;
  }
  if (!parts.length) return undefined;
  const merge = [...under, src, ...over].map((r) => `<feMergeNode in="${r}"/>`).join('');
  const id = doc.id('f');
  // 滤镜区域用形状自己的坐标：按效果伸出的距离再加上线宽的余量（细长形状、线条按百分比算会被裁掉）
  const m = pad + 20;
  doc.addDef(`<filter id="${id}" filterUnits="userSpaceOnUse" x="${n2(-m)}" y="${n2(-m)}" width="${n2(w + 2 * m)}" height="${n2(h + 2 * m)}">${parts.join('')}<feMerge>${merge}</feMerge></filter>`);
  return id;
}
