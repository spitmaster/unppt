/**
 * 三维旋转（a:scene3d/a:camera）：形状所在的平面绕中心转动后投影到屏幕上（PowerPoint 实测，见 SPEC 第 7 节）。
 *   - 预设相机的三个转角和视角是用 COM 读的：RotationX 绕竖轴（左右转）、RotationY 绕横轴（上下翻）、RotationZ 在平面内；
 *     XML 写了 a:rot 时 lon = −RotationX、lat = RotationY、rev = −RotationZ（1/60000 度）；
 *   - 先绕竖轴、再绕横轴、最后在平面内转（12 种预设的导出图轮廓交并比 0.93，剩下的是边框和文字）；
 *   - 透视的投影中心是形状中心，相机距离 = 幻灯片宽度的一半 / tan(视角/2)（三种大小的形状实测）。
 * SVG 只有仿射变换：正交投影是精确的；透视按网格切成三角形分别仿射（见 perspective.ts），
 * 只要一个矩阵的地方（拉伸方向等）取四个角的最小二乘仿射近似。
 * 转动后正面的明暗按三点灯光（model/light-rig.ts 的 faceLight）。斜投影（oblique、legacy）预设暂按正视图。
 */
import { attr, child, numAttr, type XEl } from '../io/xml';
import type { SvgDoc } from '../common/svg';
import { faceLight } from '../model/light-rig';

/** 预设：[绕竖轴, 绕横轴, 平面内, 视角, 是否透视]（度） */
const PRESETS: Record<string, [number, number, number, number, number]> = {
  isometricTopUp: [45.28, -35.4, -60.16, 45, 0],
  isometricTopDown: [-45.28, -35.4, 60.16, 45, 0],
  isometricBottomUp: [-45.28, 35.4, -60.16, 45, 0],
  isometricBottomDown: [45.28, 35.4, 60.16, 45, 0],
  isometricLeftUp: [-45.0, -35.0, 0.0, 45, 0],
  isometricLeftDown: [-45.0, 35.0, 0.0, 45, 0],
  isometricRightUp: [45.0, 35.0, 0.0, 45, 0],
  isometricRightDown: [45.0, -35.0, 0.0, 45, 0],
  isometricOffAxis1Left: [-64.0, 18.0, 0.0, 45, 0],
  isometricOffAxis1Right: [26.0, 18.0, 0.0, 45, 0],
  isometricOffAxis1Top: [53.45, -58.74, -57.64, 45, 0],
  isometricOffAxis2Left: [-26.0, 18.0, 0.0, 45, 0],
  isometricOffAxis2Right: [64.0, 18.0, 0.0, 45, 0],
  isometricOffAxis2Top: [-53.45, -58.74, 57.64, 45, 0],
  isometricOffAxis3Left: [-64.0, -18.0, 0.0, 45, 0],
  isometricOffAxis3Right: [26.0, -18.0, 0.0, 45, 0],
  isometricOffAxis3Bottom: [53.45, 58.74, 57.64, 45, 0],
  isometricOffAxis4Left: [-26.0, -18.0, 0.0, 45, 0],
  isometricOffAxis4Right: [64.0, -18.0, 0.0, 45, 0],
  isometricOffAxis4Bottom: [-53.45, 58.74, -57.64, 45, 0],
  perspectiveFront: [0.0, 0.0, 0.0, 45, 1],
  perspectiveLeft: [-20.0, 0.0, 0.0, 45, 1],
  perspectiveRight: [20.0, 0.0, 0.0, 45, 1],
  perspectiveAbove: [0.0, -20.0, 0.0, 45, 1],
  perspectiveBelow: [0.0, 20.0, 0.0, 45, 1],
  perspectiveAboveLeftFacing: [-14.34, 39.31, 18.88, 45, 1],
  perspectiveAboveRightFacing: [14.34, 39.31, -18.88, 45, 1],
  perspectiveContrastingLeftFacing: [-43.94, 10.4, 3.55, 45, 1],
  perspectiveContrastingRightFacing: [43.94, 10.4, -3.55, 45, 1],
  perspectiveHeroicLeftFacing: [-14.29, -11.02, -2.63, 45, 1],
  perspectiveHeroicRightFacing: [14.29, -11.02, 2.63, 45, 1],
  perspectiveHeroicExtremeLeftFacing: [-34.46, 8.12, 2.91, 80, 1],
  perspectiveHeroicExtremeRightFacing: [34.46, 8.12, -2.91, 80, 1],
  perspectiveRelaxed: [0.0, -50.44, 0.0, 45, 1],
  perspectiveRelaxedModerately: [0.0, -35.16, 0.0, 45, 1],
};

type M3 = number[][];
const mul = (a: M3, b: M3): M3 => a.map((r) => [0, 1, 2].map((j) => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j]));
const rot = (axis: 'x' | 'y' | 'z', deg: number): M3 => {
  const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  if (axis === 'x') return [[1, 0, 0], [0, c, -s], [0, s, c]];
  if (axis === 'y') return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
};
/** 角度规整到 ±180 */
const norm = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/** 相机的转角和视角；正视（没有转动）时返回 undefined */
function cameraOf(scene3d: XEl | undefined): { rx: number; ry: number; rz: number; fov: number; persp: boolean } | undefined {
  const cam = child(scene3d, 'a:camera');
  if (!cam) return undefined;
  const p = PRESETS[attr(cam, 'prst') ?? ''];
  const r = child(cam, 'a:rot');
  const fovAttr = numAttr(cam, 'fov');
  let rx = p?.[0] ?? 0, ry = p?.[1] ?? 0, rz = p?.[2] ?? 0;
  if (r) {
    rx = norm(-(numAttr(r, 'lon') ?? 0) / 60000);
    ry = norm((numAttr(r, 'lat') ?? 0) / 60000);
    rz = norm(-(numAttr(r, 'rev') ?? 0) / 60000);
  }
  if (!rx && !ry && !rz) return undefined;
  const persp = p ? p[4] === 1 : (attr(cam, 'prst') ?? '').startsWith('perspective');
  return { rx, ry, rz, fov: fovAttr !== undefined ? fovAttr / 60000 : p?.[3] ?? 45, persp };
}

/**
 * 形状开了三维相机（非默认的预设，或者写了转角）：PowerPoint 用三维渲染画它，正面和带棱台的形状一样被灯光提亮
 * （实测：纯灰 128 不转 128、透视正面 139、等轴测 133~135——等轴测的朝向几乎不影响亮度）
 */
export function hasCamera(scene3d: XEl | undefined): boolean {
  const cam = child(scene3d, 'a:camera');
  if (!cam) return false;
  return (attr(cam, 'prst') ?? 'orthographicFront') !== 'orthographicFront' || !!cameraOf(scene3d);
}

/** 先绕竖轴、再绕横轴、最后在平面内转 */
const rotationOf = (c: { rx: number; ry: number; rz: number }): M3 => mul(rot('z', c.rz), mul(rot('x', -c.ry), rot('y', c.rx)));

/** 转动、投影后的线性部分 [a, b, c, d]（(x, y) -> (a x + c y, b x + d y)，相对形状中心）：正交时精确，透视取四个角的最小二乘 */
function fitAffine(scene3d: XEl | undefined, w: number, h: number, slideW: number): [number, number, number, number] | undefined {
  const c = cameraOf(scene3d);
  if (!c) return undefined;
  const M = rotationOf(c);
  const d = c.persp ? slideW / 2 / Math.tan((c.fov * Math.PI) / 360) : Infinity;
  const src: [number, number][] = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  let sxx = 0, sxy = 0, syy = 0, ux = 0, uy = 0, vx = 0, vy = 0;
  for (const [x, y] of src) {
    const X = M[0][0] * x + M[0][1] * y, Y = M[1][0] * x + M[1][1] * y, Z = M[2][0] * x + M[2][1] * y;
    const f = isFinite(d) ? d / (d - Z) : 1;
    const px = X * f, py = Y * f;
    sxx += x * x; sxy += x * y; syy += y * y;
    ux += px * x; uy += px * y; vx += py * x; vy += py * y;
  }
  const det = sxx * syy - sxy * sxy;
  if (!det) return undefined;
  // 相机缩放（zoom，千分之一百分比；SmartArt 的三维样式常用 92%）
  const z = (numAttr(child(scene3d, 'a:camera'), 'zoom') ?? 100000) / 100000;
  return [z * (ux * syy - uy * sxy) / det, z * (vx * syy - vy * sxy) / det, z * (uy * sxx - ux * sxy) / det, z * (vy * sxx - vx * sxy) / det];
}

/**
 * 透视投影：w×h 的形状里一点（局部坐标，原点在左上角）投影后的位置（同一坐标系，投影中心是形状中心，含相机缩放）。
 * 正交预设、没有转动时返回 undefined（用 cameraTransform 的仿射就是精确的）
 */
export function perspectiveProjector(scene3d: XEl | undefined, w: number, h: number, slideW: number): ((x: number, y: number) => [number, number]) | undefined {
  const c = cameraOf(scene3d);
  if (!c || !c.persp) return undefined;
  const M = rotationOf(c);
  const d = slideW / 2 / Math.tan((c.fov * Math.PI) / 360);
  const z = (numAttr(child(scene3d, 'a:camera'), 'zoom') ?? 100000) / 100000;
  return (x, y) => {
    const u = x - w / 2, v = y - h / 2;
    const Z = M[2][0] * u + M[2][1] * v;
    const f = (d / Math.max(d * 0.05, d - Z)) * z;
    return [w / 2 + (M[0][0] * u + M[0][1] * v) * f, h / 2 + (M[1][0] * u + M[1][1] * v) * f];
  };
}

/**
 * w×h 的形状（局部坐标，原点在左上角）转动、投影后的仿射矩阵，写成 SVG 的 matrix(a b c d e f)，
 * 投影中心是形状中心；没有三维旋转时返回 undefined
 */
export function cameraTransform(scene3d: XEl | undefined, w: number, h: number, slideW: number): string | undefined {
  const m = fitAffine(scene3d, w, h, slideW);
  if (!m) return undefined;
  const [a, b, c, d] = m;
  const e = w / 2 - (a * w / 2 + c * h / 2), f = h / 2 - (b * w / 2 + d * h / 2);
  const r = (v: number) => +v.toFixed(5);
  return `matrix(${r(a)} ${r(b)} ${r(c)} ${r(d)} ${r(e)} ${r(f)})`;
}

/**
 * 拉伸（a:sp3d 的 extrusionH）：深度 depth 像素的背面在投影前的局部坐标里相对正面的偏移。
 * scene3d、w、h 是决定视角的那次投影（形状自己的，或者 SmartArt 整张图的场景）；相机没转动时侧面看不见，返回 undefined
 */
export function extrusionOffset(scene3d: XEl | undefined, depth: number, w: number, h: number, slideW: number): [number, number] | undefined {
  const c = cameraOf(scene3d);
  const m = fitAffine(scene3d, w, h, slideW);
  if (!c || !m || depth <= 0) return undefined;
  const M = rotationOf(c);
  // 屏幕上：背面在 z = −depth；换回局部坐标用同一个仿射的逆
  const vx = -M[0][2] * depth, vy = -M[1][2] * depth;
  const [a, b, cc, d] = m, det = a * d - b * cc;
  if (Math.abs(det) < 1e-6 || Math.hypot(vx, vy) < 0.5) return undefined;
  return [(d * vx - cc * vy) / det, (-b * vx + a * vy) / det];
}

/** 拉伸：深度 depth 像素的背面在投影后相对正面的偏移（透视取中心处的值）；没有转动或偏移太小时返回 undefined */
export function extrusionScreenOffset(scene3d: XEl | undefined, depth: number): [number, number] | undefined {
  const c = cameraOf(scene3d);
  if (!c || depth <= 0) return undefined;
  const M = rotationOf(c);
  const z = (numAttr(child(scene3d, 'a:camera'), 'zoom') ?? 100000) / 100000;
  const v: [number, number] = [-M[0][2] * depth * z, -M[1][2] * depth * z];
  return Math.hypot(v[0], v[1]) < 0.5 ? undefined : v;
}

/** 拉伸的侧面：沿背面方向叠多层变暗的形状几何（近似实心的侧面），画在正面下面 */
export function extrusionSides(geom: string, offset: [number, number], doc: SvgDoc): string {
  const n = Math.min(40, Math.max(2, Math.ceil(Math.hypot(offset[0], offset[1]) / 1.2)));
  const id = doc.id('f');
  // 侧面比正面暗（大致按三点灯光下侧面的亮度）
  doc.addDef(`<filter id="${id}" color-interpolation-filters="sRGB"><feComponentTransfer>${['R', 'G', 'B'].map((ch) => `<feFunc${ch} type="linear" slope="${SIDE_SHADE}"/>`).join('')}</feComponentTransfer></filter>`);
  const layers: string[] = [];
  for (let k = n; k >= 1; k--) layers.push(`<g transform="translate(${+(offset[0] * k / n).toFixed(2)} ${+(offset[1] * k / n).toFixed(2)})">${geom}</g>`);
  return `<g filter="url(#${id})">${layers.join('')}</g>`;
}

/** 侧面颜色相对正面的比例 */
const SIDE_SHADE = 0.6;

/** 转动后正面的明暗：在 defs 里加一个调色滤镜，返回编号；变化很小或没有转动时返回 undefined */
export function cameraLightFilter(scene3d: XEl | undefined, doc: SvgDoc): string | undefined {
  const c = cameraOf(scene3d);
  // 实测：等轴测（正交）预设转动后亮度几乎不变（0.98~1.06），透视预设才按朝向变亮变暗；
  // 灯光模型只对默认的三点灯光拟合过，别的灯光方案（SmartArt 三维样式常用"平衡""平面"）不调
  const rig = attr(child(scene3d, 'a:lightRig'), 'rig') ?? 'threePt';
  if (!c || !c.persp || rig !== 'threePt') return undefined;
  const M = rotationOf(c);
  const { k, add } = faceLight([M[0][2], M[1][2], M[2][2]]);
  if (Math.abs(k - 1) < 0.01 && add < 0.004) return undefined;
  const id = doc.id('f');
  const fn = ['R', 'G', 'B'].map((ch) => `<feFunc${ch} type="linear" slope="${+k.toFixed(4)}" intercept="${+add.toFixed(4)}"/>`).join('');
  doc.addDef(`<filter id="${id}" color-interpolation-filters="sRGB"><feComponentTransfer>${fn}</feComponentTransfer></filter>`);
  return id;
}
