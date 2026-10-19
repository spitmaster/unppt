/**
 * 图表里画的形状（c:chartSpace/c:userShapes 指向的绘图部件，cdr: 前缀）：换成幻灯片形状（p: 前缀），
 * 按锚点放在图表框里、画在图表上面（实测 charts-user-shapes）。
 * 锚点：cdr:relSizeAnchor 的 from / to 是占图表宽高的比例；cdr:absSizeAnchor 是 from 比例 + ext（EMU）
 */
import { attr, child, type XEl } from '../../io/xml';
import { EMU_PER_PX, type SlideContext } from '../../model/model';
import type { FrameRenderer } from './frame-handler';

const SHAPES = new Set(['cdr:sp', 'cdr:cxnSp', 'cdr:pic', 'cdr:grpSp', 'cdr:graphicFrame']);

/** cdr: 前缀整棵换成 p:（a: 等其它前缀不动） */
function toSlideNames(el: XEl): XEl {
  return { ...el, name: el.name.startsWith('cdr:') ? `p:${el.name.slice(4)}` : el.name, children: el.children.map(toSlideNames) };
}

const num = (el: XEl | undefined) => Number(el?.text ?? 0) || 0;

/** 把锚点算出的框写进形状的 xfrm（组合的保留 chOff / chExt，转动、翻转照旧） */
function placed(shape: XEl, x: number, y: number, w: number, h: number): XEl {
  const prName = shape.name === 'p:grpSp' ? 'p:grpSpPr' : shape.name === 'p:graphicFrame' ? undefined : 'p:spPr';
  const emu = (v: number) => String(Math.round(v * EMU_PER_PX));
  const off: XEl = { name: 'a:off', attrs: { x: emu(x), y: emu(y) }, text: '', children: [] };
  const ext: XEl = { name: 'a:ext', attrs: { cx: emu(w), cy: emu(h) }, text: '', children: [] };
  const fix = (xfrm: XEl | undefined, name: string): XEl => ({
    name, attrs: { ...(xfrm?.attrs ?? {}) }, text: '',
    children: [off, ext, ...(xfrm?.children ?? []).filter((c) => c.name !== 'a:off' && c.name !== 'a:ext')],
  });
  if (!prName) {
    const kids = shape.children.filter((c) => c.name !== 'p:xfrm');
    return { ...shape, children: [...kids, fix(child(shape, 'p:xfrm'), 'p:xfrm')] };
  }
  const pr = child(shape, prName) ?? { name: prName, attrs: {}, text: '', children: [] };
  const pr2: XEl = { ...pr, children: [fix(child(pr, 'a:xfrm'), 'a:xfrm'), ...pr.children.filter((c) => c.name !== 'a:xfrm')] };
  return { ...shape, children: child(shape, prName) ? shape.children.map((c) => (c === pr ? pr2 : c)) : [...shape.children, pr2] };
}

/** 图表框（box 的宽高，像素）里的用户形状；画在图表框的局部坐标里 */
export async function chartUserShapes(chartPart: string, chartXml: XEl, box: { x: number; y: number; w: number; h: number; rot: number }, r: FrameRenderer, ctx: SlideContext): Promise<string> {
  const rid = attr(child(chartXml, 'c:userShapes'), 'r:id');
  if (!rid) return '';
  const pkg = r.env.pres.pkg;
  const rel = await pkg.rel(chartPart, rid);
  const drawing = rel ? await pkg.xml(rel.target, false) : undefined;
  if (!drawing) return '';
  const list: XEl[] = [];
  for (const a of drawing.children) {
    const shape = a.children.find((c) => SHAPES.has(c.name));
    if (!shape) continue;
    const from = child(a, 'cdr:from');
    const x = num(child(from, 'cdr:x')) * box.w, y = num(child(from, 'cdr:y')) * box.h;
    let w: number, h: number;
    if (a.name === 'cdr:relSizeAnchor') {
      const to = child(a, 'cdr:to');
      w = num(child(to, 'cdr:x')) * box.w - x;
      h = num(child(to, 'cdr:y')) * box.h - y;
    } else if (a.name === 'cdr:absSizeAnchor') {
      const ext = child(a, 'cdr:ext');
      w = (Number(attr(ext, 'cx')) || 0) / EMU_PER_PX;
      h = (Number(attr(ext, 'cy')) || 0) / EMU_PER_PX;
    } else continue;
    list.push(placed(toSlideNames(shape), x, y, Math.max(0, w), Math.max(0, h)));
  }
  if (!list.length) return '';
  // 像素对齐的坐标原点挪到图表框左上角（框转动时不知道）
  const t = ctx.toSlide === undefined ? { x: 0, y: 0, sx: 1, sy: 1 } : ctx.toSlide;
  const toSlide = t && !box.rot ? { x: t.x + t.sx * box.x, y: t.y + t.sy * box.y, sx: t.sx, sy: t.sy } : null;
  const sub: SlideContext = { ...ctx, part: rel!.target, ownSlide: false, toSlide };
  return r.shapes(list, sub);
}
