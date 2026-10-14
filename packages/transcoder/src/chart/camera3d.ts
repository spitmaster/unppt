/**
 * 透视三维图（c:view3D 的 rAngAx = 0，三维折线图、三维面积图的默认）的相机和光照。
 * PowerPoint 实测（charts-3d-line 的导出图和 COM 生成的探针图；墙上网格线的位置和端点拟合到 0.1~0.2 像素）：
 *   - 箱体：宽 1（分类方向）、高 H、深 D，中心在原点；x 向右、y 向上、z 往里；
 *   - 先绕竖直轴转 rotY（右前角转向观众），再俯视 rotX；针孔透视，相机离箱体中心的距离（像素）
 *     = 0.5 × 内框高 / tan(perspective / 4°)，即竖直视场角 perspective / 2 度对着内框的高
 *     （perspective 是 c:perspective 的值；透视 15、30、60、100 四档、各种箱体比例拟合，误差 0.3% 以内）；perspective = 0 时平行投影；
 *   - 屏幕位置 = 投影中心 + 缩放 × (相机坐标 + 偏移) × L / (L + 深度)；投影中心、缩放、偏移见 cat3d-persp.ts；
 *   - 面的明暗：箱体坐标里固定方向的平行光 + 环境光（和视角无关），系数 = 0.395 + 0.753 × max(0, n·l)：
 *     正面 1.0、顶面 0.77、右侧面 0.64、背光的面 0.395（面积图、折线图带子各个面的颜色反推）。
 */
import type { Rgba } from '../model/color';
import type { View3D } from './model';

export type Vec3 = [number, number, number];

export interface Placement {
  /** 投影中心（屏幕） */
  cx: number; cy: number;
  /** 缩放：箱体宽 1 对应的像素 */
  s: number;
  /** 相机坐标里的偏移（宽的倍数） */
  ox: number; oy: number;
  /** 相机离箱体中心的距离（宽的倍数）；0 是平行投影 */
  L: number;
}

export interface Camera3D {
  view: View3D;
  /** 箱体坐标 -> 相机坐标（转动后、投影前；第三项是深度，越大越远） */
  rotate(p: Vec3): Vec3;
  /** 箱体坐标 -> 屏幕 */
  pt(p: Vec3): [number, number];
  /** 相机在箱体坐标里的位置（平行投影时是很远处），判断面朝不朝向观众用 */
  eye: Vec3;
  /** 缩放：箱体宽 1 对应的像素 */
  scale: number;
}

/** 相机距离（宽的倍数）：内框高 innerH、缩放 s（像素） */
export const cameraDistance = (view: View3D, innerH: number, s: number) =>
  (view.perspective > 0 ? (0.5 * innerH) / (s * Math.tan((view.perspective / 4) * Math.PI / 180)) : 0);

export function cameraOf(view: View3D, pl: Placement): Camera3D {
  const t = (view.rotY * Math.PI) / 180, f = (view.rotX * Math.PI) / 180;
  const ct = Math.cos(t), st = Math.sin(t), cf = Math.cos(f), sf = Math.sin(f);
  const L = pl.L;
  const rotate = ([x, y, z]: Vec3): Vec3 => {
    const x1 = x * ct + z * st, z1 = -x * st + z * ct;
    return [x1, y * cf + z1 * sf, -y * sf + z1 * cf];
  };
  // 相机在相机坐标里是 (−ox, −oy, −L)（平行投影时取很远）；转回箱体坐标
  const far = L > 0 ? L : 1e6;
  const [ex, ey, ez] = [-pl.ox, -pl.oy, -far];
  const z1 = ey * sf + ez * cf, y1 = ey * cf - ez * sf;
  const eye: Vec3 = [ex * ct - z1 * st, y1, ex * st + z1 * ct];
  return {
    view, rotate, eye, scale: pl.s,
    pt(p) {
      const [a, b, c] = rotate(p);
      const k = L > 0 ? L / (L + c) : 1;
      return [pl.cx + pl.s * (a + pl.ox) * k, pl.cy - pl.s * (b + pl.oy) * k];
    },
  };
}

/** 实测：光的方向（箱体坐标，单位向量）、环境光和漫反射系数 */
const LIGHT: Vec3 = [0.3255, 0.498, -0.804];
const AMBIENT = 0.395, DIFFUSE = 0.7527;

/** 法线为 n（单位向量）的面的颜色 */
export function litColor(c: Rgba, n: Vec3): Rgba {
  const k = AMBIENT + DIFFUSE * Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return { r: ch(c.r), g: ch(c.g), b: ch(c.b), a: c.a };
}

/** 面（顶点 ps、法线 n）朝向相机 */
export const facesEye = (cam: Camera3D, ps: Vec3[], n: Vec3) =>
  n[0] * (cam.eye[0] - ps[0][0]) + n[1] * (cam.eye[1] - ps[0][1]) + n[2] * (cam.eye[2] - ps[0][2]) > 0;

export function unit(x: number, y: number, z: number): Vec3 {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}
