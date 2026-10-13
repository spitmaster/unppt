/**
 * 文字排版：在转码时用字体的真实字宽算好每一行，输出每行（每段样式）一个 SVG <text>。
 * 这样换行位置固定，不依赖观看者浏览器的排版。
 * 流程：body.ts 文本框属性 -> paragraph.ts 逐段排版（measure / linebreak / bullets）-> emit.ts 定位输出。
 */
import { n2 } from '../common/svg';
import { child, children, type XEl } from '../io/xml';
import { readBody } from './body';
import { BulletNumbering } from './bullets';
import { emitParagraphs } from './emit';
import { makeMeasurer } from './measure';
import { layoutParagraph } from './paragraph';
import { fontRefLevels } from './style';
import type { ParagraphLayout, StyleChain, TextBox, TextEnv } from './types';

export type { FontEmbedder, StyleChain, TextBox, TextEnv } from './types';

/**
 * 排版并输出 SVG。bodyPrs 从一般到具体（母版 -> 版式 -> 形状）。
 * 返回 SVG 片段；没有文字时返回空串。
 */
export async function renderText(
  txBody: XEl | undefined,
  chain: StyleChain,
  bodyPrs: (XEl | undefined)[],
  box: TextBox,
  env: TextEnv,
  out?: { height: number },
): Promise<string> {
  if (!txBody) return '';
  const paras = children(txBody, 'a:p');
  if (!paras.length) return '';
  const hasText = paras.some((p) => p.children.some((r) => (r.name === 'a:r' || r.name === 'a:fld') && (child(r, 'a:t')?.text ?? '').length > 0));
  if (!hasText) return '';

  const b = readBody(bodyPrs, child(txBody, 'a:bodyPr'));
  const { lIns, rIns, wrap, vert, fontScale, lnReduce, vertical, numCol, spcCol } = b;

  const outer = vertical ? { x: 0, y: 0, w: box.h, h: box.w } : { x: 0, y: 0, w: box.w, h: box.h };
  const contentW = Math.max(1, (outer.w - lIns - rIns - (numCol - 1) * spcCol) / numCol);
  // 实测：渐变文字的渐变铺满整个文本框，而不是文字本身的范围
  env.gradBox = { w: outer.w, h: outer.h };
  const measurer = makeMeasurer(env);
  const lstStyle = child(txBody, 'a:lstStyle');
  // 形状样式（p:style/a:fontRef）指定的文字颜色：优先级高于默认文字样式，低于形状自己的列表样式和文字属性
  const fontRefStyle = env.fontRefColor ? fontRefLevels(env.fontRefColor) : undefined;
  const fullChain: StyleChain = [...chain, fontRefStyle, lstStyle];

  const layouts: ParagraphLayout[] = [];
  const ctx = { fullChain, env, measurer, fontScale, lnReduce, contentW, wrap, numbering: new BulletNumbering() };
  for (let pi = 0; pi < paras.length; pi++) layouts.push(await layoutParagraph(paras[pi], pi, ctx));

  const parts = emitParagraphs(layouts, b, outer, contentW, env, out);
  if (!parts.length) return '';

  let transform = `translate(${n2(box.x)} ${n2(box.y)})`;
  if (vert === 'vert270') transform = `translate(${n2(box.x)} ${n2(box.y + box.h)}) rotate(-90)`;
  else if (vertical) transform = `translate(${n2(box.x + box.w)} ${n2(box.y)}) rotate(90)`;
  return `<g transform="${transform}">${parts.join('')}</g>`;
}
