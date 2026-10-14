/**
 * 透视三维图里的立体：折线的带子（薄板）、面积的厚片，拆成带颜色和远近的面，画的时候按远近从后往前排。
 * 面的颜色按法线和固定的光算（camera3d.ts 的 litColor）。
 */
import type { Rgba } from '../model/color';
import { facesEye, litColor, unit, type Camera3D, type Vec3 } from './camera3d';

/** 一个面：箱体坐标的顶点、颜色、排序用的远近 */
export interface Face { ps: Vec3[]; color: Rgba; far: number }

/** 平均远近（相机坐标的深度） */
const farOf = (cam: Camera3D, ps: Vec3[]) => ps.reduce((a, q) => a + cam.rotate(q)[2], 0) / ps.length;

/** 一个面：朝向相机的一侧按法线着色（背面朝向相机时用反方向的法线） */
function face(cam: Camera3D, ps: Vec3[], n: Vec3, color: Rgba, twoSided: boolean): Face | undefined {
  const toward = facesEye(cam, ps, n);
  if (!toward && !twoSided) return undefined;
  return { ps, color: litColor(color, toward ? n : [-n[0], -n[1], -n[2]]), far: farOf(cam, ps) };
}

/**
 * 折线的带子：每段是一块薄板（深 z0~z1、厚 t），画顶面或底面（看哪面朝向相机）和朝向观众的前侧窄边
 * （实测：带子的厚度在导出图上约 1.5 像素，背光的底面上能看到一条亮边）
 */
export function ribbonFaces(top: [number, number][], z0: number, z1: number, t: number, color: Rgba, cam: Camera3D): Face[] {
  const out: Face[] = [];
  const add = (f: Face | undefined) => f && out.push(f);
  for (let i = 0; i + 1 < top.length; i++) {
    const [xa, ya] = top[i], [xb, yb] = top[i + 1];
    const n = unit(-(yb - ya), xb - xa, 0);
    const up = facesEye(cam, [[xa, ya, z0]], n);
    const yA = up ? ya : ya - t, yB = up ? yb : yb - t;
    add(face(cam, [[xa, yA, z0], [xb, yB, z0], [xb, yB, z1], [xa, yA, z1]], n, color, true));
    // 前侧窄边（法线朝观众）：盖在顶面或底面的前沿上
    const edge = face(cam, [[xa, ya, z0], [xb, yb, z0], [xb, yb - t, z0], [xa, ya - t, z0]], [0, 0, -1], color, false);
    if (edge) add({ ...edge, far: edge.far - 1e-6 });
  }
  return out;
}

/** 面积的厚片：正面、背面（多边形）、每段的顶面、两头的端面；只画朝向相机的 */
export function slabFaces(top: [number, number][], low: [number, number][], z0: number, z1: number, color: Rgba, cam: Camera3D): Face[] {
  const out: Face[] = [];
  const add = (f: Face | undefined) => f && out.push(f);
  const outline = (z: number): Vec3[] => [...top.map(([x, y]) => [x, y, z] as Vec3), ...[...low].reverse().map(([x, y]) => [x, y, z] as Vec3)];
  add(face(cam, outline(z0), [0, 0, -1], color, false));
  add(face(cam, outline(z1), [0, 0, 1], color, false));
  for (let i = 0; i + 1 < top.length; i++) {
    const [xa, ya] = top[i], [xb, yb] = top[i + 1];
    add(face(cam, [[xa, ya, z0], [xb, yb, z0], [xb, yb, z1], [xa, ya, z1]], unit(-(yb - ya), xb - xa, 0), color, false));
    const [la, lya] = low[i], [lb, lyb] = low[i + 1];
    add(face(cam, [[la, lya, z0], [lb, lyb, z0], [lb, lyb, z1], [la, lya, z1]], unit(lyb - lya, -(lb - la), 0), color, false));
  }
  const n = top.length - 1;
  add(face(cam, [[top[0][0], low[0][1], z0], [top[0][0], top[0][1], z0], [top[0][0], top[0][1], z1], [top[0][0], low[0][1], z1]], [-1, 0, 0], color, false));
  add(face(cam, [[top[n][0], low[n][1], z0], [top[n][0], top[n][1], z0], [top[n][0], top[n][1], z1], [top[n][0], low[n][1], z1]], [1, 0, 0], color, false));
  // 正面最后画（离观众最近）
  return out.map((f, i) => (i === 0 ? { ...f, far: -Infinity } : f));
}
