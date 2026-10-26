/**
 * 复合饼图、复合条饼图的数据标签。规则和依据见 SPEC 第 7 节（COM 生成两种复合饼图 × 四种标签位置 × 三种图表大小，导出图量红色标签）：
 *   - 主饼的扇区（含"其他"块）、右边饼的扇区按饼图的规则摆（pie-slice-label.ts）；
 *   - 右边条的每一段：数据标签外、最佳位置（不写时的默认）放在条的右边，竖向对着这一段的中间；数据标签内贴着这一段的上头，
 *     轴内侧贴着下头，居中在这一段的中间；
 *   - "其他"块的标签是数据点 n（n 个数据点之后的那一个）：分类名是"其他"（英文界面"Other"），值、百分比是右边各点的和
 */
import { cpart } from './draw';
import { pointLabel, shiftLabel } from './point-labels';
import { labelMaxWidth, LABEL_PAD_Y, wrapLabel } from './label-wrap';
import { drawLines, measureLines } from './pie-labels';
import { sliceLabel, sliceLabelText } from './pie-slice-label';
import type { TextWidth } from './layout';
import type { Series } from './model';

const PT = 96 / 72;
/** 实测：数据标签外（最佳位置）的标签，文字左边离条的右边 6.3 磅（10、16 磅字，三种图表大小，误差 ≤ 0.5 磅） */
const BAR_GAP = 6.3 * PT;
/** 实测：数据标签内 / 轴内侧的标签框（含上下 1.5 磅内边距）离这一段的上边 / 下边 2.5 磅 */
const BAR_INSET = 2.5 * PT;

/** 一个扇区：数据点序号（n 是"其他"块）、从角 a1 顺时针到 a2（弧度） */
export interface OfSlice { i: number; a1: number; a2: number }
/** 条的一段：数据点序号、左上角和宽高（像素） */
export interface OfBar { i: number; x: number; y: number; w: number; h: number }

export interface OfPieParts {
  /** 主饼：圆心、半径、扇区 */
  cx: number; cy: number; r: number; main: OfSlice[];
  /** 右边的饼（复合饼图）：圆心、半径、扇区 */
  c2?: number; r2?: number; second?: OfSlice[];
  /** 右边的条（复合条饼图） */
  bars?: OfBar[];
}

/**
 * 各点的标签（cpart 包好的 SVG）。vals 是各点的值（"其他"块在 n 处），pcts 是按总和取整好的百分比（同样在 n 处有"其他"），
 * zh 是中文界面，box 是图表宽高
 */
export function ofPieLabels(s: Series, parts: OfPieParts, vals: number[], pcts: number[], zh: boolean, tw: TextWidth, box: { w: number; h: number }): string[] {
  const n = vals.length - 1;
  const total = vals.slice(0, n).reduce((a, b) => a + b, 0);
  const out: string[] = [];
  const one = (i: number, place: (raw: string, pl: ReturnType<typeof pointLabel>) => string) => {
    const pl = pointLabel(s, i), lb = pl.labels;
    if (!lb) return;
    const cat = i === n ? (zh ? '其他' : 'Other') : s.cats[i] ?? '';
    out.push(place(sliceLabelText(s, pl, i, lb, { v: vals[i], total, cat, pct: pcts[i] }), pl));
  };
  const pie = (c: number, r: number, list: OfSlice[]) => {
    for (const sl of list) {
      one(sl.i, (raw, pl) => sliceLabel(`${s.index}x${sl.i}`, raw, pl.labels!, pl, { cx: c, cy: parts.cy, r, ri: 0, a1: sl.a1, a2: sl.a2, ex: 0 }, tw, box));
    }
  };
  pie(parts.cx, parts.r, parts.main);
  if (parts.second && parts.c2 !== undefined && parts.r2 !== undefined) pie(parts.c2, parts.r2, parts.second);
  for (const b of parts.bars ?? []) {
    one(b.i, (raw, pl) => {
      const lb = pl.labels!, st = lb.style;
      const l = measureLines(wrapLabel(raw, box.w ? labelMaxWidth(box.w) : Infinity, st.size, tw, st.font), st, tw);
      const bw = Math.max(...l.widths), bh = l.heights.reduce((a, c) => a + c, 0);
      let x = b.x + b.w / 2, y = b.y + b.h / 2;
      if (lb.pos === 'inEnd') y = b.y + BAR_INSET + LABEL_PAD_Y + bh / 2;
      else if (lb.pos === 'inBase') y = b.y + b.h - BAR_INSET - LABEL_PAD_Y - bh / 2;
      else if (lb.pos !== 'ctr') x = b.x + b.w + BAR_GAP + bw / 2;
      return cpart(`${s.index}x${b.i}l`, shiftLabel(drawLines(l, x, y, st), pl, box));
    });
  }
  return out;
}
