/**
 * 饼图类（饼图、圆环图、复合饼图的两个饼）一个扇区的数据标签：文字（没写分隔符时怎么隔开）、按位置摆好（最佳位置、数据标签外、
 * 内、居中、手动拖开）。规则和依据见 SPEC 第 7 节；最佳位置放进扇区还是饼外见 pie-labels.ts
 */
import { cpart } from './draw';
import { labelParts, labelText, sourceFmt } from './format';
import { pointLabelText, shiftLabel, type PointLabel } from './point-labels';
import { labelMaxWidth, wrapLabel } from './label-wrap';
import { drawLines, fitInside, measureLines, placeOutside } from './pie-labels';
import type { TextWidth } from './layout';
import type { Labels, Series } from './model';

/** 扇区：圆心、半径、内圆半径（圆环，饼是 0）、从角 a1 顺时针到 a2（弧度，0 朝右）、分离出去的距离（像素） */
export interface SliceAt { cx: number; cy: number; r: number; ri: number; a1: number; a2: number; ex: number }

/** 有没有放在外面的标签（最佳位置——不写时的默认、数据标签外，系列的或单个点的）：数据标签内、居中的都在扇区里 */
export function labelsOutside(s: Series): boolean {
  const outside = (l: { pos?: string } | undefined) => !!l && l.pos !== 'inEnd' && l.pos !== 'ctr';
  return outside(s.labels) || [...(s.pointLabels?.values() ?? [])].some((l) => outside(l.labels));
}

/**
 * 有放在外面的标签、绘图区自动时，给标签留地方后剩下的长度（像素）：0.875 × 长度 − 2.75 磅。实测（COM 读 PlotArea.InsideWidth /
 * InsideHeight，导出图核对）：复合饼图、复合条饼图的绘图区宽、高各自这样缩（三种图表大小、四种标签位置）；和标签的字号（6~24 磅）、
 * 文字长短、引导线、图例都无关
 */
export const labelRoom = (d: number) => 0.875 * d - 2.75 * 96 / 72;

/** 一个点的标签要显示的数：值、总和、分类名、按总和取整好的百分比 */
export interface SliceValue { v: number; total: number; cat: string; pct: number }

/** 标签文字：没写分隔符时有百分比是换行，类别名 + 值是", "（实测 charts-pie-label-sep、charts-pie-bestfit） */
export function sliceLabelText(s: Series, pl: PointLabel, i: number, lb: Labels, d: SliceValue): string {
  const vf = sourceFmt(s, i);
  const sep = lb.pct ? '\n' : ', ';
  return pointLabelText(s, pl, i, () => labelText(lb, d.v, d.total, d.cat, s.name, vf, d.pct, sep), () => labelParts(lb, d.v, d.total, d.cat, vf, d.pct));
}

/** 摆好的标签（cpart 包好的 SVG）；key 是部件编号（`系列x点`），box 是图表宽高 */
export function sliceLabel(key: string, raw: string, lb: Labels, pl: PointLabel, sl: SliceAt, tw: TextWidth, box: { w: number; h: number }): string {
  const { cx, cy, r, ri, ex } = sl;
  const mid = (sl.a1 + sl.a2) / 2;
  const st = lb.style, maxW = box.w ? labelMaxWidth(box.w) : Infinity;
  const cos = Math.cos(mid), sin = Math.sin(mid);
  const manualMove = !!(pl.dx || pl.dy);
  // "最佳位置"（没写位置也是）：放得进扇区（必要时折窄）就放在里面，放不下放到饼外（实测，见 pie-labels.ts）；手动拖开的不管
  if (!ri && (!lb.pos || lb.pos === 'bestFit') && !manualMove) {
    const inside = fitInside(raw, maxW, st, tw, { r, a1: sl.a1, a2: sl.a2 });
    const l = inside?.l ?? measureLines(wrapLabel(raw, maxW, st.size, tw, st.font), st, tw);
    const at = inside ? { x: cx + ex * cos + inside.x, y: cy + ex * sin + inside.y } : placeOutside(l, cx, cy, r + ex, mid, box);
    return cpart(`${key}l`, drawLines(l, at.x, at.y, st));
  }
  const l = measureLines(wrapLabel(raw, maxW, st.size, tw, st.font), st, tw);
  const bw = Math.max(...l.widths), bh = l.heights.reduce((a, b) => a + b, 0);
  let lx: number, ly: number;
  // 手动拖开的标签：偏移是相对外侧的位置算的（实测 charts-point-labels）
  if (!ri && (lb.pos === 'outEnd' || (manualMove && lb.pos !== 'ctr' && lb.pos !== 'inEnd'))) {
    // 外侧：从圆心沿角平分线走到"半径 + 1.25 × 字号"处，标签往外摆（右边的从这里往右、上面的往上，实测）
    const d = r + ex + 1.25 * st.size;
    lx = cx + d * cos + (cos * bw) / 2; ly = cy + d * sin + (sin * bh) / 2;
  } else {
    // 圆环在环的中间，居中在半径的一半处，数据标签内在 0.8 倍半径处（都随分离的扇区一起移出）
    const rr = (ri ? (r + ri) / 2 : lb.pos === 'ctr' ? r * 0.5 : r * 0.8) + ex;
    lx = cx + rr * cos; ly = cy + rr * sin;
  }
  return cpart(`${key}l`, shiftLabel(drawLines(l, lx, ly, st), pl, box));
}
