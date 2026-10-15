/**
 * 文字排版：在转码时用字体的真实字宽算好每一行，输出每行（每段样式）一个 SVG <text>。
 * 这样换行位置固定，不依赖观看者浏览器的排版。
 * 流程：body.ts 文本框属性 -> paragraph.ts 逐段排版（measure / linebreak / bullets）-> emit.ts 定位输出。
 */
import { n2 } from '../common/svg';
import { attr, child, children, type XEl } from '../io/xml';
import { readBody } from './body';
import { faceLighting, has3d } from '../style/lighting';
import { hasCamera } from '../style/camera';
import { BulletNumbering } from './bullets';
import { emitParagraphs, placeLines } from './emit';
import { makeMeasurer } from './measure';
import { layoutParagraph } from './paragraph';
import { fontRefLevels, styleFonts } from './style';
import type { ParagraphLayout, StyleChain, TextBox, TextEnv } from './types';
import { warpOf, warpText } from './warp';

export type { FontEmbedder, StyleChain, TextBox, TextEnv } from './types';

/**
 * 排版并输出 SVG。bodyPrs 从一般到具体（母版 -> 版式 -> 形状）。
 * 返回 SVG 片段；没有文字时返回空串。
 */
/** 图片填充的文字（a:blipFill）：输出前把用到的图片解析成地址（输出文字是同步的） */
async function pictureFills(layouts: ParagraphLayout[], env: TextEnv): Promise<Map<XEl, string> | undefined> {
  const blips = new Set<XEl>();
  for (const l of layouts) for (const line of l.lines) for (const a of line.atoms) if (a.style.blip) blips.add(a.style.blip);
  if (!blips.size || !env.images || !env.part) return undefined;
  const out = new Map<XEl, string>();
  for (const b of blips) {
    const rid = attr(child(b, 'a:blip'), 'r:embed');
    const href = rid ? await env.images.image(env.part, rid) : undefined;
    if (href) out.set(b, href);
  }
  return out;
}

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
  // 文字的三维效果（棱台等）：颜色按三维光照提亮
  if (has3d(b.sp3d) || hasCamera(b.scene3d)) env = { ...env, lit3d: faceLighting(attr(child(b.scene3d, 'a:lightRig'), 'rig'), attr(b.sp3d, 'prstMaterial')), sp3d: b.sp3d };
  const { lIns, rIns, wrap, vert, fontScale, lnReduce, vertical, numCol, spcCol } = b;

  const outer = vertical ? { x: 0, y: 0, w: box.h, h: box.w } : { x: 0, y: 0, w: box.w, h: box.h };
  const contentW = Math.max(1, (outer.w - lIns - rIns - (numCol - 1) * spcCol) / numCol);
  // 文本框的范围：文字效果滤镜的区域（渐变文字按行铺，见 svg-text.ts）
  env.gradBox = { w: outer.w, h: outer.h };
  const measurer = makeMeasurer(env);
  const lstStyle = child(txBody, 'a:lstStyle');
  // 形状样式（p:style/a:fontRef）指定的文字颜色和主题字体：优先级高于默认文字样式，低于形状自己的列表样式和文字属性
  const refFonts = styleFonts(env.fontRef);
  const fontRefStyle = env.fontRefColor || refFonts.length ? fontRefLevels(env.fontRefColor, refFonts) : undefined;
  const fullChain: StyleChain = [...chain, fontRefStyle, lstStyle];

  const layouts: ParagraphLayout[] = [];
  const ctx = { fullChain, env, measurer, fontScale, lnReduce, contentW, wrap, numbering: new BulletNumbering() };
  for (let pi = 0; pi < paras.length; pi++) layouts.push(await layoutParagraph(paras[pi], pi, ctx));
  env.blipHrefs = await pictureFills(layouts, env);

  // 艺术字变形：变不了（跟随路径类、缺字体文件）时按普通文字输出
  const warp = vertical ? undefined : warpOf([...bodyPrs, child(txBody, 'a:bodyPr')]);
  if (warp) {
    const warped = await warpText(warp, layouts, placeLines(layouts, b, outer, contentW, out), box, env);
    if (warped?.length) return `<g transform="translate(${n2(box.x)} ${n2(box.y)})">${warped.join('')}</g>`;
  }

  // 横排文字的基线对齐整像素（实测）：文字原点取整到 floor(y + 0.331)，每行基线相对外框四舍五入（先加 0.2，抵消浏览器和 PowerPoint 字形落点的差别）；
  // 在对齐像素里算（pixelScale：当前坐标 -> 对齐像素）
  const top = env.pixelTop, s = env.pixelScale ?? 1;
  const snapY = top !== undefined && !vertical ? (v: number) => (Math.floor(top + 0.331) - top + Math.round(s * (box.y + v) + 0.2) - s * box.y) / s : undefined;
  const parts = emitParagraphs(layouts, b, outer, contentW, { ...env, snapY }, out);
  if (!parts.length) return '';

  let transform = `translate(${n2(box.x)} ${n2(box.y)})`;
  if (vert === 'vert270') transform = `translate(${n2(box.x)} ${n2(box.y + box.h)}) rotate(-90)`;
  else if (vertical) transform = `translate(${n2(box.x + box.w)} ${n2(box.y)}) rotate(90)`;
  return `<g transform="${transform}">${parts.join('')}</g>`;
}
