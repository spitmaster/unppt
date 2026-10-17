/**
 * 透视三维的分类图（c:line3DChart、c:area3DChart，rAngAx = 0）：箱体的背景墙、侧墙上的网格线，地板前沿的分类轴、
 * 右沿的系列轴和刻度线，坐标轴标签，折线的带子、面积的厚片（面按远近从后往前画）。
 * 相机和光照见 camera3d.ts，箱体比例和摆放见 persp-layout.ts，带子和厚片的面见 solids3d.ts。
 * PowerPoint 实测（charts-3d-line 和 COM 生成的探针图）：
 *   - 箱体宽 1，深 D = 槽数 / 分类数 × 深度%（槽数：系列沿深度排时是系列数，堆积时是 1），
 *     高 H = heightCells / 分类数 × 内框高 / 内框宽（高度百分比不起作用：设成 50%、200% 导出图逐像素不变）；
 *   - 每个系列占一个深度槽，带子（厚片）的深度 = 槽深 / (1 + 间隙深度%)，在槽里居中；
 *   - 数值轴不加 5% 余量，刻度疏密和平面图一样按内框的高算。
 */
import { css, type ColorContext } from '../model/color';
import { n2 } from '../common/svg';
import { attr, child, type XEl } from '../io/xml';
import { parseLine } from '../style/line';
import { cameraOf, type Vec3 } from './camera3d';
import { heightCells, innerRect, placeBox } from './persp-layout';
import { ribbonFaces, slabFaces } from './solids3d';
import { cpart, hasCjk, label, textStyle } from './draw';
import { catBand, sideAnchor, valBand, type TextWidth } from './layout';
import type { AxisInfo, AxisMaker, Plot, Rect, TextStyle, View3D } from './model';

export interface Persp3DEnv { colors: ColorContext; part: string; baseText: TextStyle; makeAxis: AxisMaker; tw: TextWidth; view: View3D }

/** 能按透视三维画的：一个 line3DChart 或 area3DChart，不是直角坐标轴 */
export const isPersp3D = (plots: Plot[], view?: View3D) =>
  !!view && !view.rAngAx && plots.length === 1 && plots[0].is3D && (plots[0].kind === 'line' || plots[0].kind === 'area');

/** 实测：折线带子的厚度（像素） */
const RIBBON_PX = 1.5;

export function renderPersp3D(p: Plot, valAx: XEl | undefined, catAx: XEl | undefined, serAx: XEl | undefined, area: Rect, env: Persp3DEnv, out: string[]): void {
  const { colors, baseText, makeAxis, tw, view } = env;
  const area3d = p.kind === 'area';
  const inDepth = p.grouping === 'standard';
  const stacked = p.grouping === 'stacked' || p.grouping === 'percentStacked';
  const cats = p.series[0]?.cats ?? [];
  const nCat = Math.max(1, ...p.series.map((s) => s.vals.length));
  const nSer = Math.max(1, p.series.length);
  const slots = inDepth ? nSer : 1;
  const between = attr(child(valAx, 'c:crossBetween'), 'val') !== 'midCat';
  const H0 = heightCells(nCat, nSer, stacked) / nCat, D = (slots / nCat) * (view.depthPercent / 100);
  // 数值范围（堆积按分类求和）
  const totals = Array.from({ length: nCat }, (_, i) => p.series.reduce((a, s) => a + Math.abs(s.vals[i] ?? 0), 0) || 1);
  const value = (s: number, i: number) => {
    const v = p.series[s].vals[i] ?? 0;
    return p.grouping === 'percentStacked' ? v / totals[i] : v;
  };
  let vmin = 0, vmax = 0;
  for (let i = 0; i < nCat; i++) {
    let pos = 0, neg = 0;
    for (let s = 0; s < nSer; s++) {
      const v = value(s, i);
      if (stacked) { if (v >= 0) pos += v; else neg += v; } else { vmax = Math.max(vmax, v); vmin = Math.min(vmin, v); }
    }
    if (stacked) { vmax = Math.max(vmax, pos); vmin = Math.min(vmin, neg); }
  }
  const catStyle = textStyle(child(catAx, 'c:txPr'), colors, baseText);
  const serStyle = textStyle(child(serAx, 'c:txPr'), colors, baseText);
  const catDeleted = attr(child(catAx, 'c:delete'), 'val') === '1' || attr(child(catAx, 'c:tickLblPos'), 'val') === 'none';
  const serDeleted = !inDepth || !serAx || attr(child(serAx, 'c:delete'), 'val') === '1' || attr(child(serAx, 'c:tickLblPos'), 'val') === 'none';
  const names = p.series.map((s) => s.name);
  // 系列轴在相机那一侧的地板侧边上；轴在屏幕上较平（斜率 < 0.5，例如转角 40°、俯角 15°）时标签放到轴下方，不占左右
  const rad = (d: number) => (d * Math.PI) / 180;
  const serRight = Math.sin(rad(view.rotY)) >= 0;
  const serBelow = Math.abs((Math.sin(rad(view.rotX)) * Math.cos(rad(view.rotY))) / (Math.sin(rad(view.rotY)) || 1e-9)) < SER_STEEP;
  // 内框（去掉标签，和平面的分类轴图一样排）定了箱体的高宽比；刻度疏密也和平面图一样按内框的高，两遍
  const innerOf = (A: AxisInfo) => innerRect(area, {
    val: A.deleted || A.lblPos === 'none' ? 0 : Math.max(0, ...A.labels.map((t) => tw(t, A.style.size, A.style.font))), valSize: A.style.size,
    cat: catDeleted ? 0 : catStyle.size, catBand: cats.some(hasCjk) ? catBand(catStyle.size) : valBand(catStyle.size),
    ends: !between && !catDeleted && cats.length ? [tw(cats[0], catStyle.size, catStyle.font), tw(cats[cats.length - 1], catStyle.size, catStyle.font)] : undefined,
    ser: serDeleted || serBelow ? 0 : Math.max(0, ...names.map((t) => tw(t, serStyle.size, serStyle.font))), serRight,
  });
  const axisOpts = { pct: p.grouping === 'percentStacked', margin: 0 };
  const in0 = innerOf(makeAxis(valAx, vmin, vmax, axisOpts));
  const A = makeAxis(valAx, vmin, vmax, { ...axisOpts, length: in0.bottom - in0.top });
  const inner = innerOf(A);
  const H = H0 * (inner.bottom - inner.top) / Math.max(1, inner.right - inner.left);
  const cam = cameraOf(view, placeBox(view, H, D, inner));
  const P = (q: Vec3) => { const [x, y] = cam.pt(q); return `${n2(x)} ${n2(y)}`; };
  const vy = (v: number) => -H / 2 + A.pos(Math.max(A.lo, Math.min(A.hi, v))) * H;
  // 看得见的墙：远离相机的那一面（相机在右前上方时是背景墙 z = D/2、左侧墙 x = −0.5、地板 y = −H/2）
  const wz = cam.eye[2] < 0 ? D / 2 : -D / 2, wx = cam.eye[0] > 0 ? -0.5 : 0.5, fy = cam.eye[1] > 0 ? -H / 2 : H / 2;
  const nz = -wz, nx = -wx;
  // 网格线：背景墙上横线、侧墙上斜线
  if (A.grid?.color) {
    const d = A.ticks.map((t) => { const y = vy(t); return `M${P([nx, y, wz])}L${P([wx, y, wz])}L${P([wx, y, nz])}`; }).join('');
    out.push(`<path d="${d}" fill="none" stroke="${css(A.grid.color)}" stroke-width="${n2(A.grid.width)}"/>`);
  }
  // 分类轴在地板靠近观众的边（z = nz），系列轴在地板靠近观众的侧边（x = nx）
  const catLine = parseLine([child(child(catAx, 'c:spPr'), 'a:ln')], [colors], env.part);
  const serLine = parseLine([child(child(serAx, 'c:spPr'), 'a:ln')], [colors], env.part);
  const catX = (i: number) => (between ? -0.5 + (i + 0.5) / nCat : -0.5 + i / Math.max(1, nCat - 1));
  const slotZ = (j: number) => -D / 2 + ((j + 0.5) * D) / slots;
  const TICK = 0.012;
  if (catLine?.color && attr(child(catAx, 'c:delete'), 'val') !== '1') {
    const marks = Array.from({ length: between ? nCat + 1 : nCat }, (_, i) => (between ? -0.5 + i / nCat : catX(i)));
    const d = `M${P([-0.5, fy, nz])}L${P([0.5, fy, nz])}` + marks.map((x) => `M${P([x, fy, nz])}L${P([x, fy - TICK, nz])}`).join('');
    out.push(`<path d="${d}" fill="none" stroke="${css(catLine.color)}" stroke-width="${n2(catLine.width)}"/>`);
  }
  if (inDepth && serLine?.color && serAx && attr(child(serAx, 'c:delete'), 'val') !== '1') {
    const marks = Array.from({ length: slots + 1 }, (_, j) => -D / 2 + (j * D) / slots);
    const d = `M${P([nx, fy, -D / 2])}L${P([nx, fy, D / 2])}` + marks.map((z) => `M${P([nx, fy, z])}L${P([nx + Math.sign(nx) * TICK, fy, z])}`).join('');
    out.push(`<path d="${d}" fill="none" stroke="${css(serLine.color)}" stroke-width="${n2(serLine.width)}"/>`);
  }
  const base = new Array(nCat).fill(0);
  const tops = p.series.map((_, s) => Array.from({ length: nCat }, (_, i) => value(s, i)));
  const lows: number[][] = [];
  for (let s = 0; s < nSer; s++) {
    lows.push(base.slice());
    if (stacked) for (let i = 0; i < nCat; i++) { base[i] += tops[s][i]; tops[s][i] = base[i]; }
  }
  // 系列沿深度排时后排先画（相机在前方时 z 大的在后），堆积时从下往上画
  const seq = Array.from({ length: nSer }, (_, j) => j);
  if (inDepth && cam.eye[2] < 0) seq.reverse();
  for (const s of seq) {
    const ser = p.series[s];
    const color = ser.fill ?? ser.line?.color;
    if (!color) continue;
    const slot = inDepth ? s : 0;
    const half = D / slots / (1 + p.gapDepth / 100) / 2;
    const z0 = slotZ(slot) - half, z1 = slotZ(slot) + half;
    const top = tops[s].map((v, i) => [catX(i), vy(v)] as [number, number]);
    const low = lows[s].map((v, i) => [catX(i), vy(stacked ? v : Math.max(A.lo, Math.min(A.hi, 0)))] as [number, number]);
    const faces = area3d ? slabFaces(top, low, z0, z1, color, cam) : ribbonFaces(top, z0, z1, RIBBON_PX / cam.scale, color, cam);
    faces.sort((a, b) => b.far - a.far);
    out.push(cpart(`${ser.index}`, faces.map((f) => `<path d="M${f.ps.map(P).join('L')}Z" fill="${css(f.color)}" stroke="${css(f.color)}" stroke-width="0.3" stroke-linejoin="round"/>`).join('')));
  }
  // 坐标轴标签
  if (!A.deleted && A.lblPos !== 'none') {
    A.ticks.forEach((t, i) => {
      const [x, y] = cam.pt([-0.5, vy(t), nz]);
      out.push(label(A.labels[i], x - sideAnchor(A.style.size), y, A.style, 'end'));
    });
  }
  // 分类标签在地板前沿下方、系列标签在系列轴外侧（或下方）：轴在屏幕上是斜的，标签框离轴线最近的角保持固定间距
  const slope = (a: Vec3, b: Vec3) => { const [x1, y1] = cam.pt(a), [x2, y2] = cam.pt(b); return (y2 - y1) / (x2 - x1 || 1e-9); };
  const below = (t: string, a: Vec3, b: Vec3, st: TextStyle) => {
    const [x, y] = cam.pt([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
    const m = Math.abs(slope(a, b)), sz = st.size;
    return label(t, x, y + (m * tw(t, sz, st.font)) / 2 + CAT_GAP * sz * Math.hypot(1, m) + sz / 2, st);
  };
  if (!catDeleted) cats.forEach((c, i) => out.push(below(c, [catX(i) - 0.01, fy, nz], [catX(i) + 0.01, fy, nz], catStyle)));
  if (!serDeleted) {
    names.forEach((nm, j) => {
      const z = slotZ(j);
      if (serBelow) { out.push(below(nm, [nx, fy, z - 0.01], [nx, fy, z + 0.01], serStyle)); return; }
      const [x, y] = cam.pt([nx, fy, z]);
      const m = Math.max(0.2, Math.abs(slope([nx, fy, z - 0.01], [nx, fy, z + 0.01])));
      const gap = SER_GAP * serStyle.size + serStyle.size / 2 / m;
      out.push(label(nm, serRight ? x + gap : x - gap, y, serStyle, serRight ? 'start' : 'end'));
    });
  }
}

/**
 * 实测（charts-3d-line 两种视角的导出图）：分类标签框（高 = 字号）的上角到地板前沿的垂直间距 0.64 × 字号；
 * 系列标签起点在系列轴右边 0.63 × 字号，再加上半个字号按轴的斜率折算的横向距离
 */
const CAT_GAP = 0.64, SER_GAP = 0.63;
/** 系列轴在屏幕上的斜率小于这个值时，系列标签放到轴下方（实测：俯角 15° 转角 40° 在下方，俯角 30° 转角 40° 在右边） */
const SER_STEEP = 0.5;
