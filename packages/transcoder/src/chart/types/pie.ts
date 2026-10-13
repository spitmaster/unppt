/** 饼图、圆环图：自己占满绘图区，图例按分类列出 */
import { css, type ColorContext } from '../../model/color';
import { n2 } from '../../common/svg';
import { accentColor, cpart, label } from '../draw';
import { labelText } from '../format';
import type { Plot } from '../model';
import type { ChartType } from '../chart-type';

function renderPie(p: Plot, x: number, y: number, w: number, h: number, colors: ColorContext): string {
  const s = p.series[0];
  if (!s) return '';
  const vals = s.vals.map((v) => Math.max(0, v ?? 0));
  const total = vals.reduce((a, b) => a + b, 0);
  if (!total) return '';
  const cx = x + w / 2, cy = y + h / 2;
  // 实测：没有数据标签时饼图直径约为绘图区较短边的 96.5%；有标签时 PowerPoint 会缩小到约 84% 给标签留空间
  const r = Math.min(w, h) / 2 * (s.labels ? 0.84 : 0.965);
  const ri = p.kind === 'doughnut' ? r * p.holeSize / 100 : 0;
  let ang = (p.firstSliceAng - 90) * Math.PI / 180;
  const out: string[] = [];
  const labels: string[] = [];
  vals.forEach((v, i) => {
    if (!v) return;
    const a2 = ang + (v / total) * Math.PI * 2;
    const large = a2 - ang > Math.PI ? 1 : 0;
    const p1 = [cx + r * Math.cos(ang), cy + r * Math.sin(ang)], p2 = [cx + r * Math.cos(a2), cy + r * Math.sin(a2)];
    const color = s.pointFills.get(i) ?? (p.varyColors || p.kind === 'pie' || p.kind === 'doughnut' ? accentColor(i, colors) : s.fill) ?? accentColor(i, colors);
    let d: string;
    if (v === total) {
      d = `M${n2(cx - r)} ${n2(cy)}A${n2(r)} ${n2(r)} 0 1 1 ${n2(cx + r)} ${n2(cy)}A${n2(r)} ${n2(r)} 0 1 1 ${n2(cx - r)} ${n2(cy)}Z`;
      if (ri) d += `M${n2(cx - ri)} ${n2(cy)}A${n2(ri)} ${n2(ri)} 0 1 0 ${n2(cx + ri)} ${n2(cy)}A${n2(ri)} ${n2(ri)} 0 1 0 ${n2(cx - ri)} ${n2(cy)}Z`;
    } else if (ri) {
      const q1 = [cx + ri * Math.cos(a2), cy + ri * Math.sin(a2)], q2 = [cx + ri * Math.cos(ang), cy + ri * Math.sin(ang)];
      d = `M${n2(p1[0])} ${n2(p1[1])}A${n2(r)} ${n2(r)} 0 ${large} 1 ${n2(p2[0])} ${n2(p2[1])}L${n2(q1[0])} ${n2(q1[1])}A${n2(ri)} ${n2(ri)} 0 ${large} 0 ${n2(q2[0])} ${n2(q2[1])}Z`;
    } else {
      d = `M${n2(cx)} ${n2(cy)}L${n2(p1[0])} ${n2(p1[1])}A${n2(r)} ${n2(r)} 0 ${large} 1 ${n2(p2[0])} ${n2(p2[1])}Z`;
    }
    out.push(cpart(`${s.index}x${i}`, `<path d="${d}" fill="${css(color)}" fill-rule="evenodd" stroke="#fff" stroke-width="1.5"/>`));
    const lb = s.labels;
    if (lb) {
      // 默认"最佳位置"：扇形内部靠外边缘；圆环在环的中间
      const mid = (ang + a2) / 2;
      const rr = ri ? (r + ri) / 2 : lb.pos === 'ctr' ? r * 0.5 : lb.pos === 'outEnd' ? r + lb.style.size : r * 0.8;
      labels.push(cpart(`${s.index}x${i}l`, label(labelText(lb, v, total, s.cats[i] ?? '', s.name, 'General'), cx + rr * Math.cos(mid), cy + rr * Math.sin(mid), lb.style)));
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
  render: (p: Plot, a: { left: number; top: number; right: number; bottom: number }, ctx: { colors: ColorContext }) => renderPie(p, a.left, a.top, a.right - a.left, a.bottom - a.top, ctx.colors),
};

export const pieType: ChartType = { ...pieBase, kind: 'pie', tags: ['pieChart', 'pie3DChart', 'ofPieChart'] };
export const doughnutType: ChartType = { ...pieBase, kind: 'doughnut', tags: ['doughnutChart'] };
