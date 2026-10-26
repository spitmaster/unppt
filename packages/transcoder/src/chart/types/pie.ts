/** 饼图、圆环图：自己占满绘图区，图例按分类列出 */
import { css, type ColorContext } from '../../model/color';
import { n2 } from '../../common/svg';
import { accentColor, cpart, strokeOf } from '../draw';
import { piePercents } from '../format';
import { pointLabel } from '../point-labels';
import { sliceLabel, sliceLabelText } from '../pie-slice-label';
import type { TextWidth } from '../layout';
import type { ChartContext, Plot, Rect } from '../model';
import type { Line } from '../../style/line';
import { renderPie3D } from './pie3d';
import type { ChartType } from '../chart-type';

/** 扇区（圆环时带内圆）的路径：从角 a1 顺时针到 a2（弧度，0 在右边）；full 是整圆 */
export function slicePath(cx: number, cy: number, r: number, ri: number, a1: number, a2: number, full: boolean): string {
  if (full) {
    let d = `M${n2(cx - r)} ${n2(cy)}A${n2(r)} ${n2(r)} 0 1 1 ${n2(cx + r)} ${n2(cy)}A${n2(r)} ${n2(r)} 0 1 1 ${n2(cx - r)} ${n2(cy)}Z`;
    if (ri) d += `M${n2(cx - ri)} ${n2(cy)}A${n2(ri)} ${n2(ri)} 0 1 0 ${n2(cx + ri)} ${n2(cy)}A${n2(ri)} ${n2(ri)} 0 1 0 ${n2(cx - ri)} ${n2(cy)}Z`;
    return d;
  }
  const large = a2 - a1 > Math.PI ? 1 : 0;
  const p1 = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)], p2 = [cx + r * Math.cos(a2), cy + r * Math.sin(a2)];
  if (ri) {
    const q1 = [cx + ri * Math.cos(a2), cy + ri * Math.sin(a2)], q2 = [cx + ri * Math.cos(a1), cy + ri * Math.sin(a1)];
    return `M${n2(p1[0])} ${n2(p1[1])}A${n2(r)} ${n2(r)} 0 ${large} 1 ${n2(p2[0])} ${n2(p2[1])}L${n2(q1[0])} ${n2(q1[1])}A${n2(ri)} ${n2(ri)} 0 ${large} 0 ${n2(q2[0])} ${n2(q2[1])}Z`;
  }
  return `M${n2(cx)} ${n2(cy)}L${n2(p1[0])} ${n2(p1[1])}A${n2(r)} ${n2(r)} 0 ${large} 1 ${n2(p2[0])} ${n2(p2[1])}Z`;
}

/** 没写边框时扇区之间的白线 */
const PIE_EDGE: Line = { color: { r: 255, g: 255, b: 255, a: 1 }, width: 1.5, cap: 'butt', join: 'round' };

function renderPie(p: Plot, x: number, y: number, w: number, h: number, colors: ColorContext, tw: TextWidth, box: { w: number; h: number }, manual = false): string {
  const s = p.series[0];
  if (!s) return '';
  const vals = s.vals.map((v) => Math.max(0, v ?? 0));
  const pcts = piePercents(vals);
  const total = vals.reduce((a, b) => a + b, 0);
  if (!total) return '';
  const cx = x + w / 2, cy = y + h / 2;
  // 实测：没有数据标签时饼图直径等于绘图区的短边（chart.ts 排出的绘图区）；
  // 有标签时 PowerPoint 会缩小给标签留空间（约宽的 84%、高的 86.7%，"最佳位置"的标签放在扇区里也缩）；绘图区手动摆放时不缩
  // （样本：标签拖到饼外的饼图铺满手动内框）
  // 标签都放在扇区里（数据标签内 inEnd、居中 ctr）时不缩（实测 charts-pie-label-pos）；最佳位置（不写时的默认）、数据标签外才缩
  const outside = (l: { pos?: string } | undefined) => !!l && l.pos !== 'inEnd' && l.pos !== 'ctr';
  const labeled = outside(s.labels) || [...(s.pointLabels?.values() ?? [])].some((l) => outside(l.labels));
  const r = (labeled && !manual ? (p.kind === 'doughnut' ? Math.min(w * 0.84, h * 0.867) : Math.min(w, h) * 0.865) : Math.min(w, h)) / 2;
  const ri = p.kind === 'doughnut' ? r * p.holeSize / 100 : 0;
  let ang = (p.firstSliceAng - 90) * Math.PI / 180;
  const out: string[] = [];
  const labels: string[] = [];
  vals.forEach((v, i) => {
    if (!v) return;
    const a2 = ang + (v / total) * Math.PI * 2;
    const color = s.pointFills.get(i) ?? (p.varyColors || p.kind === 'pie' || p.kind === 'doughnut' ? accentColor(i, colors) : s.fill) ?? accentColor(i, colors);
    const d = slicePath(cx, cy, r, ri, ang, a2, v === total);
    // 分离的扇区沿角平分线移出 explosion% 个半径（实测：饼图本身不缩小）
    const ex = v === total ? 0 : s.explosion(i) / 100 * r, mid = (ang + a2) / 2;
    const move = ex ? ` transform="translate(${n2(ex * Math.cos(mid))} ${n2(ex * Math.sin(mid))})"` : '';
    out.push(cpart(`${s.index}x${i}`, `<path d="${d}" fill="${s.pointPaints?.get(i) ?? css(color)}" fill-rule="evenodd"${strokeOf(s, i, PIE_EDGE)}${move}/>`));
    const pl = pointLabel(s, i), lb = pl.labels;
    if (lb) {
      const raw = sliceLabelText(s, pl, i, lb, { v, total, cat: s.cats[i] ?? '', pct: pcts[i] });
      labels.push(sliceLabel(`${s.index}x${i}`, raw, lb, pl, { cx, cy, r, ri, a1: ang, a2, ex }, tw, box));
    }
    ang = a2;
  });
  return out.join('') + labels.join('');
}

const pieBase = {
  layout: 'standalone' as const,
  hasAxes: false,
  legendByCategory: true,
  seriesRules: () => ({ xy: false, defaultLine: false, marker: () => false }),
  legendKey: (_p: Plot, s: Plot['series'][number]) => ({ color: s.fill, line: false }),
  render: (p: Plot, a: Rect, ctx: ChartContext) => (p.is3D && p.kind === 'pie' && ctx.view3D ? renderPie3D(p, a, ctx.view3D, ctx.colors, ctx.defs, ctx.box) : renderPie(p, a.left, a.top, a.right - a.left, a.bottom - a.top, ctx.colors, ctx.width, ctx.box, ctx.manual)),
};

export const pieType: ChartType = { ...pieBase, kind: 'pie', tags: ['pieChart', 'pie3DChart'] };
export const doughnutType: ChartType = { ...pieBase, kind: 'doughnut', tags: ['doughnutChart'] };
