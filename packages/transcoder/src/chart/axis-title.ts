/**
 * 坐标轴标题（c:valAx / c:catAx 里的 c:title）。PowerPoint 实测（COM 读 9~20 磅柱形、条形、散点图的标题框和绘图区）：
 *   - 标题字号没写时是图表文字的 1330/1197 倍（12 磅的图表是 13.3 磅）；标题框的厚度 = 1.3545 × 字号 + 3 磅；
 *   - 左侧的标题转 90°（竖排、从下往上读），从图表边 7 磅处开始；数值（或分类）标签从标题右边再隔 6 磅排起（COM 读 13.3 磅标题时少 0.73 像素）；
 *   - 下方的标题紧贴在标签带下面，底边离可用区域底边 6 磅；绘图区在这两个方向各让出"厚度 + 6 磅"；
 *   - 标题在绘图区的中线上居中；字形在标题框里偏下（转过来的偏右）：横排 0.11 × 字号，竖排 0.2 × 字号（导出图量字的墨迹）。
 * 文字没写时显示"坐标轴标题"（英文界面 Axis Title）。
 */
import type { ColorContext } from '../model/color';
import { attr, child, findAll, numAttr, path, type XEl } from '../io/xml';
import { n2 } from '../common/svg';
import { label, richStyle, textStyle } from './draw';
import { PAD, type TextWidth } from './layout';
import type { Rect, TextStyle } from './model';

/** pos：手动挪过的位置（manualLayout edge，标题框左上角占图表宽高的比例） */
export interface AxisTitle { text: string; style: TextStyle; pos?: { x: number; y: number } }
export interface AxisTitles { left?: AxisTitle; bottom?: AxisTitle }

const PT = 4 / 3;
const EDGE = 7 * PT, GAP = 6 * PT, LEFT_GAP = GAP - 0.73;
/** 标题框的厚度（像素；s 是字号，像素） */
const thickness = (s: number) => 1.3545 * s + 3 * PT;

export function readAxisTitle(ax: XEl | undefined, colors: ColorContext, baseText: TextStyle, zh: boolean): AxisTitle | undefined {
  const t = child(ax, 'c:title');
  if (!t || attr(child(ax, 'c:delete'), 'val') === '1') return undefined;
  const text = findAll(child(t, 'c:tx'), 'a:t').map((x) => x.text).join('') || (zh ? '坐标轴标题' : 'Axis Title');
  const st = textStyle(child(t, 'c:txPr'), colors, { ...baseText, size: (baseText.size * 1330) / 1197 });
  const ml = path(t, 'c:layout', 'c:manualLayout');
  const edge = (n: 'x' | 'y') => (attr(child(ml, `c:${n}Mode`), 'val') === 'edge' ? numAttr(child(ml, `c:${n}`), 'val') : undefined);
  const px = edge('x'), py = edge('y');
  return { text, style: richStyle(path(t, 'c:tx', 'c:rich'), colors, st), ...(px !== undefined && py !== undefined ? { pos: { x: px, y: py } } : {}) };
}

/** 左侧标题的左边：一般是图表边 7 磅；左边已经被别的东西（左侧图例）占了时紧接着它 */
const titleLeft = (area: Rect) => (area.left === PAD ? EDGE : area.left);

/** 先让出标题的位置：左边从标题右边隔 6 磅开始（标签从这里排），下边减去"厚度 + 6 磅" */
export function reserveAxisTitles(area: Rect, t: AxisTitles): Rect {
  let { left, bottom } = area;
  if (t.left) left = titleLeft(area) + thickness(t.left.style.size) + LEFT_GAP;
  if (t.bottom) bottom -= thickness(t.bottom.style.size) + GAP;
  return { ...area, left, bottom };
}

/** 标题框给定的位置：左侧标题的右边、下方标题的上边 */
export interface TitleAt { right: number; top: number }

/**
 * 绘图区是手动内框（layoutTarget inner）时标题放在哪：PowerPoint 的绘图区外框 = 内框加上和自动布局一样宽的标签带，
 * 标题贴在外框外面——左侧标题的右边是外框左边、下方标题的上边是外框下边（实测：COM 读手动内框和自动布局的外框、标题框）。
 * area 是让出标题之后的区域，auto 是从它自动排出来的绘图区（标签带 = 两者之差）
 */
export function innerTitleAt(inner: Rect, area: Rect, auto: { left: number; bottom: number }): TitleAt {
  return { right: inner.left - (auto.left - area.left + LEFT_GAP), top: inner.bottom + (area.bottom - auto.bottom) };
}

/**
 * 画标题：plot 是绘图区，area 是让出标题之前的可用区域；at 给了时按它放（手动内框）；chart 是图表宽高（手动挪过的标题用）。
 * 手动挪过的标题按存的位置放（常数见 MOVED_ALONG），绘图区不跟着变
 */
export function renderAxisTitles(t: AxisTitles, plot: Rect, area: Rect, out: string[], at?: TitleAt, chart?: { w: number; h: number }, tw?: TextWidth): void {
  const bottom = area.bottom;
  const moved = (a: AxisTitle) => (a.pos && chart ? { x: a.pos.x * chart.w, y: a.pos.y * chart.h, half: (tw ? tw(a.text, a.style.size, a.style.font) : 0) / 2 } : undefined);
  if (t.left) {
    const th = thickness(t.left.style.size), m = moved(t.left);
    const cx = (m ? m.x - MOVED_ACROSS : at ? at.right - th : titleLeft(area)) + th / 2 + 0.2 * t.left.style.size;
    const cy = m ? m.y + MOVED_ALONG + m.half : (plot.top + plot.bottom) / 2;
    out.push(`<g transform="rotate(-90 ${n2(cx)} ${n2(cy)})">${label(t.left.text, cx, cy, t.left.style)}</g>`);
  }
  if (t.bottom) {
    const th = thickness(t.bottom.style.size), m = moved(t.bottom);
    out.push(label(t.bottom.text, m ? m.x + MOVED_ALONG + m.half : (plot.left + plot.right) / 2, (m ? m.y - MOVED_DOWN : at ? at.top : bottom - GAP - th) + th / 2 + 0.11 * t.bottom.style.size, t.bottom.style));
  }
}

/**
 * 实测（charts-axis-title-moved，导出图上和我们的逐像素对位）：手动挪过的坐标轴标题，文字从存的位置沿文字方向 3.2 磅处排起
 * （和图表标题一样）；横排标题在厚度方向按框顶 = 存的 y − 1 磅、竖排标题按框左 = 存的 x − 2.5 磅放（像素）
 */
const MOVED_ALONG = 3.2 * PT, MOVED_DOWN = 1 * PT, MOVED_ACROSS = 2.5 * PT;
