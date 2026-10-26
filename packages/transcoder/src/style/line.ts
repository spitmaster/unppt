/**
 * 线条：合并主题样式和形状自己的 a:ln，生成 stroke 属性和箭头标记。
 */
import { css, type ColorContext, type Rgba } from '../model/color';
import { n2, type SvgDoc } from '../common/svg';
import { attr, child, numAttr, type XEl } from '../io/xml';
import { EMU_PER_PX } from '../model/model';
import { adjustForPathMode, findFillEl, gradientPaint, parseFill, type Fill } from './fill';

export interface Line {
  color?: Rgba;
  fill?: Fill;
  width: number;     // 像素
  dash?: string;
  cap: string;
  join: string;
  head?: { type: string; w: string; len: string };
  tail?: { type: string; w: string; len: string };
  /** 复合线型：dbl 双线、thickThin 外粗内细、thinThick 外细内粗、tri 三线（单线时不写） */
  cmpd?: string;
}

const DASH: Record<string, number[]> = {
  dash: [4, 3], sysDash: [3, 1], dot: [1, 3], sysDot: [1, 1], lgDash: [8, 3], dashDot: [4, 3, 1, 3],
  lgDashDot: [8, 3, 1, 3], lgDashDotDot: [8, 3, 1, 3, 1, 3], sysDashDot: [3, 1, 1, 1], sysDashDotDot: [3, 1, 1, 1, 1, 1],
};

/** 合并线条定义（主题样式 -> 形状自己的 a:ln），返回最终线条；noFill 返回 undefined */
/**
 * pixel：当前坐标 -> 对齐像素的比例（线宽按对齐像素取整，见 model.ts 的 DISPLAY_WIDTH；图表不给）。
 * realDash：虚线的线宽、段长按真实线宽算，不取整（表格边框；实测 lines-thin-dash：0.5 磅圆点虚线的表格边框周期 2.67 像素、很淡，
 * 形状的线周期 4 像素、1 像素宽）
 */
export function parseLine(lns: (XEl | undefined)[], ctxs: ColorContext[], part: string, pixel = 1, realDash = false): Line | undefined {
  let width = 9525;
  let fill: Fill | undefined;
  let dash: string | undefined;
  let cap = 'flat', join = 'round';
  let cmpd = 'sng';
  let head, tail;
  let any = false;
  lns.forEach((ln, i) => {
    if (!ln) return;
    any = true;
    const w = numAttr(ln, 'w');
    if (w !== undefined) width = w;
    const f = parseFill(findFillEl(ln), ctxs[i], part);
    if (f) fill = f;
    const pd = attr(child(ln, 'a:prstDash'), 'val');
    if (pd) dash = pd;
    const c = attr(ln, 'cap');
    if (c) cap = c;
    const cm = attr(ln, 'cmpd');
    if (cm) cmpd = cm;
    if (child(ln, 'a:round')) join = 'round';
    else if (child(ln, 'a:bevel')) join = 'bevel';
    else if (child(ln, 'a:miter')) join = 'miter';
    const he = child(ln, 'a:headEnd');
    if (he) head = { type: attr(he, 'type') ?? 'none', w: attr(he, 'w') ?? 'med', len: attr(he, 'len') ?? 'med' };
    const te = child(ln, 'a:tailEnd');
    if (te) tail = { type: attr(te, 'type') ?? 'none', w: attr(te, 'w') ?? 'med', len: attr(te, 'len') ?? 'med' };
  });
  if (!any || !fill || fill.kind === 'none') return undefined;
  // 不到 1 像素的细线（0.25、0.5 磅）PowerPoint 画成 1 像素宽、颜色不变淡（实测）
  const dashed = !!dash && dash !== 'solid' && !!DASH[dash];
  // 表格的虚线边框（realDash）线宽也不取整：0.5 磅的圆点虚线 PowerPoint 画得很淡
  const px = realDash && dashed ? width / EMU_PER_PX : width > 0 ? Math.max(1, Math.round(width / EMU_PER_PX * pixel)) / pixel : 0;
  const color = fill.kind === 'solid' ? fill.color : fill.kind === 'grad' ? fill.stops[0]?.color : undefined;
  return {
    color, fill, width: px,
    dash: dashed ? DASH[dash!].map((d) => n2(d * px)).join(' ') : undefined,
    cap: cap === 'rnd' ? 'round' : cap === 'sq' ? 'square' : 'butt',
    join, head, tail,
    ...(cmpd !== 'sng' && ['dbl', 'thickThin', 'thinThick', 'tri'].includes(cmpd) ? { cmpd } : {}),
  };
}

/**
 * 复合线型：用遮罩把整条粗线挖出线间的空隙（实测 PowerPoint 的比例：双线 1:1:1，三线 1:1:2:1:1，
 * 粗细线 3:1:1 且第一个词说的是外侧）。粗细线要分内外：闭合路径按形状内部区域区分，不闭合的按双线画。
 * 返回加在描边元素上的 mask 属性；不是复合线型时返回空串。
 */
export function compoundMask(line: Line, d: string, doc: SvgDoc, box: { w: number; h: number }): string {
  if (!line.cmpd) return '';
  const w = line.width;
  const id = doc.id('cm');
  const m = w * 2;
  const stroke = (width: number, color: string, clip = '') => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${n2(width)}"${clip}/>`;
  const closed = /z\s*$/i.test(d.trim());
  let body = stroke(w, '#fff');
  if (line.cmpd === 'tri') body += stroke(w * 4 / 6, '#000') + stroke(w * 2 / 6, '#fff');
  else if (line.cmpd === 'dbl' || !closed) body += stroke(w / 3, '#000');
  else {
    // 空隙在细线那一侧：外细时空隙在形状外面，外粗时在里面
    const cid = doc.id('cc');
    const outside = line.cmpd === 'thinThick';
    doc.addDef(`<clipPath id="${cid}"><path d="${outside ? `M${n2(-m)} ${n2(-m)}H${n2(box.w + m)}V${n2(box.h + m)}H${n2(-m)}Z` : ''}${d}" clip-rule="evenodd"/></clipPath>`);
    body += stroke(w * 0.6, '#000', ` clip-path="url(#${cid})"`) + stroke(w * 0.2, '#fff');
  }
  doc.addDef(`<mask id="${id}" maskUnits="userSpaceOnUse" x="${n2(-m)}" y="${n2(-m)}" width="${n2(box.w + m * 2)}" height="${n2(box.h + m * 2)}">${body}</mask>`);
  return ` mask="url(#${id})"`;
}

/**
 * 描边属性；box 是形状尺寸，给了才能画渐变线（不给时用渐变的第一个颜色）。
 * closed：路径闭合（起点已经按 dash-phase.ts 挪到闭合线段的起点），线端的相位和不闭合的不同
 */
export function strokeAttrs(line: Line | undefined, doc: SvgDoc, mode: string, box?: { w: number; h: number }, closed = false): string {
  if (!line) return ' stroke="none"';
  const c = adjustForPathMode(line.color ?? { r: 0, g: 0, b: 0, a: 1 }, mode === 'norm' ? '' : '');
  const grad = box && line.fill?.kind === 'grad' ? line.fill : undefined;
  let s = ` stroke="${grad ? gradientPaint(grad, doc, box!.w, box!.h, 'norm') : css(c)}" stroke-width="${n2(line.width)}"`;
  if (!grad && c.a < 0.999) s += ` stroke-opacity="${n2(c.a)}"`;
  if (line.dash) {
    // 圆头、方头：PowerPoint 的短划长度包含线端，SVG 的线端画在短划外面——短划减一个线宽、间隔加一个线宽（否则间隔被填满，样本）。
    // 相位（实测 lines-dash-caps、line-dash-phase）：方头的短划正好落在 [起点, 起点 + 长度]（往后挪半个线宽）；圆头不闭合时
    // 是 [起点 − 半个线宽, 起点 + 长度 − 半个线宽]（不挪），闭合时是 [起点 + 半个线宽, 起点 + 长度 + 半个线宽]（挪一个线宽）
    const capped = line.cap === 'round' || line.cap === 'square';
    const v = capped ? line.dash.split(' ').map(Number).map((x, i) => (i % 2 === 0 ? Math.max(0.01, x - line.width) : x + line.width)).map(n2).join(' ') : line.dash;
    s += ` stroke-dasharray="${v}"`;
    const shift = line.cap === 'square' ? line.width / 2 : line.cap === 'round' && closed ? line.width : 0;
    if (shift) s += ` stroke-dashoffset="${n2(-shift)}"`;
  }
  if (line.cap !== 'butt') s += ` stroke-linecap="${line.cap}"`;
  if (line.join !== 'miter') s += ` stroke-linejoin="${line.join}"`;
  return s;
}
