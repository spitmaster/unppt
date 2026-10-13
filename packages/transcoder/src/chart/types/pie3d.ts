/**
 * 三维饼图（c:pie3DChart）：饼是一个有厚度的圆柱，俯视角 rotX，带透视（c:view3D 的 perspective，直角坐标轴时没有透视）。
 * PowerPoint 实测（charts-3d 导出图，默认 rotX 30°、透视 30；用上沿、中心、近处上下沿和宽度联立解出）：等效俯角是 rotX 的 0.94 倍，
 * 相机距离约 6.75 倍半径，厚度约 0.238 倍半径（高度 100%），
 * 投影后的整体外框放进绘图区（宽 97%、高 96.5%）居中；侧壁只看得见朝向观众的一半，明暗约为
 * 顶面颜色 × (0.573 − 0.313·cos θ)（θ 是侧壁朝向，0 朝右，下限 0.40）
 */
import { css, type ColorContext, type Rgba } from '../../model/color';
import { n2 } from '../../common/svg';
import { accentColor, cpart, label } from '../draw';
import { labelText } from '../format';
import type { Plot, Rect, View3D } from '../model';

/** 厚度、相机距离（半径的倍数）、俯角系数和侧壁明暗（实测） */
const THICK = 0.238;
const DIST_K = 0.8887;
const TILT = 28.25 / 30;
const shade = (t: number) => Math.max(0.4, 0.573 - 0.313 * Math.cos(t));
const darker = (c: Rgba, k: number): Rgba => ({ r: Math.round(c.r * k), g: Math.round(c.g * k), b: Math.round(c.b * k), a: c.a });

export function renderPie3D(p: Plot, area: Rect, view: View3D, colors: ColorContext): string {
  const s = p.series[0];
  if (!s) return '';
  const vals = s.vals.map((v) => Math.max(0, v ?? 0));
  const total = vals.reduce((a, b) => a + b, 0);
  if (!total) return '';
  const rot = (view.rotX * TILT * Math.PI) / 180;
  const T = THICK * view.hPercent / 100;
  const D = view.rAngAx || !view.perspective ? Infinity : DIST_K / Math.tan((view.perspective / 4) * Math.PI / 180);
  // 单位模型：半径 1，顶面 y = 0，底面 y = −T；屏幕 y 向下，z 朝向观众
  const proj = (x: number, y: number, z: number): [number, number] => {
    const Y = -y * Math.cos(rot) + z * Math.sin(rot);
    const depth = y * Math.sin(rot) + z * Math.cos(rot);
    const f = isFinite(D) ? D / (D - depth) : 1;
    return [x * f, Y * f];
  };
  const onRim = (t: number, y: number, ex: [number, number] = [0, 0]) => proj(Math.cos(t) + ex[0], y, Math.sin(t) + ex[1]);
  // 整体外框（顶面一圈 + 底面朝向观众的一半）
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let k = 0; k < 360; k += 3) {
    const t = (k * Math.PI) / 180;
    for (const q of [onRim(t, 0), onRim(t, -T)]) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
  }
  const W = area.right - area.left, H = area.bottom - area.top;
  const S = Math.min((W * 0.97) / (x1 - x0), (H * 0.965) / (y1 - y0));
  // 实测整体比绘图区中心高约 2% 的绘图区高度（一个样例）
  const ox = area.left + W / 2 - S * (x0 + x1) / 2, oy = area.top + H * 0.48 - S * (y0 + y1) / 2;
  const pt = (q: [number, number]) => `${n2(ox + S * q[0])} ${n2(oy + S * q[1])}`;
  const rims: string[] = [], tops: string[] = [], labels: string[] = [];
  // 第一块从正上方（远处）顺时针（俯视）排，和二维饼图一样
  let ang = ((p.firstSliceAng + view.rotY - 90) * Math.PI) / 180;
  vals.forEach((v, i) => {
    if (!v) return;
    const a2 = ang + (v / total) * Math.PI * 2;
    const color = s.pointFills.get(i) ?? accentColor(i, colors);
    const mid = (ang + a2) / 2, full = v === total;
    const exr = full ? 0 : s.explosion(i) / 100;
    const ex: [number, number] = [exr * Math.cos(mid), exr * Math.sin(mid)];
    const steps = Math.max(2, Math.ceil(((a2 - ang) * 180) / Math.PI / 3));
    const arc: number[] = [];
    for (let k = 0; k <= steps; k++) arc.push(ang + ((a2 - ang) * k) / steps);
    // 侧壁：朝向观众（sin t > 0）的部分，按 5° 一段分别着色
    const seg: string[] = [];
    for (let k = 0; k < arc.length - 1; k++) {
      const ta = arc[k], tb = arc[k + 1], tm = (ta + tb) / 2;
      if (Math.sin(tm) <= 0) continue;
      const c = css(darker(color, shade(tm)));
      seg.push(`<path d="M${pt(onRim(ta, 0, ex))}L${pt(onRim(tb, 0, ex))}L${pt(onRim(tb, -T, ex))}L${pt(onRim(ta, -T, ex))}Z" fill="${c}" stroke="${c}" stroke-width="0.6"/>`);
    }
    if (seg.length) rims.push(cpart(`${s.index}x${i}r`, seg.join('')));
    // 顶面
    const top = `M${pt(proj(ex[0], 0, ex[1]))}${arc.map((t) => `L${pt(onRim(t, 0, ex))}`).join('')}Z`;
    tops.push(cpart(`${s.index}x${i}`, `<path d="${top}" fill="${css(color)}" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>`));
    const lb = s.labels;
    if (lb) {
      const rr = lb.pos === 'ctr' ? 0.5 : lb.pos === 'outEnd' ? 1.15 : 0.8;
      const q = proj(rr * Math.cos(mid) + ex[0], 0, rr * Math.sin(mid) + ex[1]);
      labels.push(cpart(`${s.index}x${i}l`, label(labelText(lb, v, total, s.cats[i] ?? '', s.name, 'General'), ox + S * q[0], oy + S * q[1], lb.style)));
    }
    ang = a2;
  });
  return rims.join('') + tops.join('') + labels.join('');
}
