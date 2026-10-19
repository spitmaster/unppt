/** 饼图、圆环图：自己占满绘图区，图例按分类列出 */
import { css, type ColorContext } from '../../model/color';
import { n2 } from '../../common/svg';
import { accentColor, cpart, multiLabel, strokeOf } from '../draw';
import { labelParts, labelText, piePercents } from '../format';
import { pointLabel, pointLabelText, shiftLabel } from '../point-labels';
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

/** 实测："最佳位置"的标签框离饼外边的距离（像素） */
const BESTFIT_GAP = 1.8 * 96 / 72;
/** 实测（charts-pie-label-wrap：300 磅宽的饼图，9/12/16 磅标签都在约 70 像素处折行）：数据标签最宽 = 图表宽 × 0.173（68~70.8 像素之间） */
const LABEL_MAX_W = 0.173;

/**
 * 数据标签太宽时折行：优先在", "后面折（逗号留在上一行），汉字之间也能折，西文单词不拆（实测 charts-pie-label-wrap）
 */
function wrapLabel(text: string, maxW: number, size: number, tw: TextWidth, font?: string): string {
  return text.split('\n').map((para) => {
    // 断点：", " 之后、汉字前后；token 是不能拆开的一段
    const tokens = para.match(/, |[⺀-鿿豈-﫿＀-￯]|[^,\s⺀-鿿豈-﫿＀-￯]+|[,\s]/g) ?? [para];
    const lines: string[] = [];
    let cur = '';
    for (const t of tokens) {
      if (cur && tw((cur + t).trimEnd(), size, font) > maxW) { lines.push(cur.trimEnd()); cur = t.trimStart(); }
      else cur += t;
    }
    if (cur) lines.push(cur.trimEnd());
    return lines.join('\n');
  }).join('\n');
}

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
  const labeled = s.labels || [...(s.pointLabels?.values() ?? [])].some((l) => l.labels);
  const r = (labeled && !manual ? Math.min(w * 0.84, h * 0.867) : Math.min(w, h)) / 2;
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
      const vf = s.valFmt ?? 'General';
      // 没写分隔符时：有百分比是换行，类别名 + 值是", "（实测 charts-pie-label-sep、charts-pie-bestfit）
      const sep = lb.pct ? '\n' : ', ';
      const raw = pointLabelText(s, pl, i, () => labelText(lb, v, total, s.cats[i] ?? '', s.name, vf, pcts[i], sep), () => labelParts(lb, v, total, s.cats[i] ?? '', vf, pcts[i]));
      const text = box.w ? wrapLabel(raw, box.w * LABEL_MAX_W, lb.style.size, tw, lb.style.font) : raw;
      const cos = Math.cos(mid), sin = Math.sin(mid);
      let lx: number, ly: number;
      const lines = text.split('\n');
      const bw = Math.max(...lines.map((t) => tw(t, lb.style.size))), bh = lines.length * 1.44 * lb.style.size;
      // "最佳位置"（没写位置也是）：标签放在扇区里贴着外边（标签框沿半径方向的半宽 + 1.8 磅；实测 charts-pie-bestfit）
      const radial = Math.abs(cos) * bw / 2 + Math.abs(sin) * bh / 2;
      const fitD = r - radial - BESTFIT_GAP;
      const bestFit = !ri && (!lb.pos || lb.pos === 'bestFit');
      // 放不下时 PowerPoint 有时挪到外侧（小扇区），规律还没量准（todo），先都放在里面
      // 手动拖开的标签：偏移是相对外侧的位置算的（实测 charts-point-labels）
      if (!ri && (lb.pos === 'outEnd' || ((pl.dx || pl.dy) && lb.pos !== 'ctr' && lb.pos !== 'inEnd'))) {
        // 外侧：从圆心沿角平分线走到"半径 + 1.25 × 字号"处，标签往外摆（右边的从这里往右、上面的往上，实测）
        const d = r + ex + 1.25 * lb.style.size;
        lx = cx + d * cos + (cos * bw) / 2; ly = cy + d * sin + (sin * bh) / 2;
      } else {
        // 圆环在环的中间（随分离的扇区一起移出）
        const rr = (ri ? (r + ri) / 2 : lb.pos === 'ctr' ? r * 0.5 : bestFit ? fitD : r * 0.8) + ex;
        lx = cx + rr * cos; ly = cy + rr * sin;
      }
      labels.push(cpart(`${s.index}x${i}l`, shiftLabel(multiLabel(text, lx, ly, lb.style), pl, box)));
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
