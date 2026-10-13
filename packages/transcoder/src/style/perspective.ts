/**
 * 图片的透视投影（三维旋转的透视类预设）：SVG 没有透视变换，把内容按网格切成三角形，每个三角形用自己的仿射变换贴到投影后的位置
 * （三个顶点处精确，内部误差按网格密度控制在 0.5 像素以内）。网格比图片大一圈，阴影、边框也在里面；
 * 剪裁三角形每条边向外推 0.75 像素，相邻三角形叠在一起，不透明的内容不露接缝（剪裁边缘的抗锯齿会留缝）。
 * 形状不用这个办法（内容要复制很多份，半透明的部分在重叠处会变深），而是把轮廓逐点投影（render/projection.ts）。
 */
import type { SvgDoc } from '../common/svg';
import { n2 } from '../common/svg';

type Project = (x: number, y: number) => [number, number];

/** 网格比形状每边多出的比例（覆盖阴影、发光、溢出的文字） */
const MARGIN = 0.35;
/** 剪裁三角形每条边向外推的像素 */
const OVERLAP = 0.75;
/** 三角形内部允许的最大误差（像素）和最密的网格 */
const MAX_ERR = 0.5, MAX_N = 8;

const r5 = (v: number) => +v.toFixed(5);

/** 把局部三角形 p 映射到 q 的仿射矩阵（SVG matrix 的六个数） */
function affine(p: [number, number][], q: [number, number][]): number[] | undefined {
  const [p0, p1, p2] = p, [q0, q1, q2] = q;
  const a = p1[0] - p0[0], b = p2[0] - p0[0], c = p1[1] - p0[1], d = p2[1] - p0[1];
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-9) return undefined;
  const ux = q1[0] - q0[0], vx = q2[0] - q0[0], uy = q1[1] - q0[1], vy = q2[1] - q0[1];
  // [A B; C D] · [a b; c d] = [ux vx; uy vy]
  const A = (ux * d - vx * c) / det, B = (vx * a - ux * b) / det;
  const Cc = (uy * d - vy * c) / det, D = (vy * a - uy * b) / det;
  return [A, Cc, B, D, q0[0] - A * p0[0] - B * p0[1], q0[1] - Cc * p0[0] - D * p0[1]];
}

/** 网格边长 n 时三角形内部（各边中点、重心）的最大误差 */
function meshError(project: Project, x0: number, y0: number, W: number, H: number, n: number): number {
  let err = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const xa = x0 + (W * i) / n, xb = x0 + (W * (i + 1)) / n, ya = y0 + (H * j) / n, yb = y0 + (H * (j + 1)) / n;
    const P: [number, number][] = [[xa, ya], [xb, ya], [xb, yb]];
    const m = affine(P, P.map(([x, y]) => project(x, y)));
    if (!m) continue;
    for (const [x, y] of [[(xa + xb) / 2, ya], [xb, (ya + yb) / 2], [(xa + xb) / 2, (ya + yb) / 2], [(2 * xb + xa) / 3, (ya + 2 * yb) / 3]]) {
      const [px, py] = project(x, y);
      err = Math.max(err, Math.hypot(m[0] * x + m[2] * y + m[4] - px, m[1] * x + m[3] * y + m[5] - py));
    }
  }
  return err;
}

/** content（w×h 局部坐标）按透视投影画出来：返回切成三角形、各自仿射的 SVG */
export function perspectiveMesh(content: string, project: Project, w: number, h: number, doc: SvgDoc): string {
  const mx = Math.max(w, h) * MARGIN;
  const x0 = -mx, y0 = -mx, W = w + 2 * mx, H = h + 2 * mx;
  let n = 1;
  while (n < MAX_N && meshError(project, x0, y0, W, H, n) > MAX_ERR) n++;
  const parts: string[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const xa = x0 + (W * i) / n, xb = x0 + (W * (i + 1)) / n, ya = y0 + (H * j) / n, yb = y0 + (H * (j + 1)) / n;
    for (const P of [[[xa, ya], [xb, ya], [xb, yb]], [[xa, ya], [xb, yb], [xa, yb]]] as [number, number][][]) {
      const Q = P.map(([x, y]) => project(x, y));
      const m = affine(P, Q);
      if (!m) continue;
      // 剪裁三角形（投影后的坐标）绕内心放大，使每条边向外推 OVERLAP
      const pts = grow(Q, OVERLAP).map(([x, y]) => `${n2(x)},${n2(y)}`).join(' ');
      const id = doc.id('c');
      doc.addDef(`<clipPath id="${id}"><polygon points="${pts}"/></clipPath>`);
      parts.push(`<g clip-path="url(#${id})"><g transform="matrix(${m.map(r5).join(' ')})">${content}</g></g>`);
    }
  }
  return parts.join('');
}

/** 三角形绕内心放大，每条边向外平移 d（内切圆半径从 r 变成 r + d） */
function grow(q: [number, number][], d: number): [number, number][] {
  const [A, B, C] = q;
  const a = Math.hypot(B[0] - C[0], B[1] - C[1]), b = Math.hypot(A[0] - C[0], A[1] - C[1]), c = Math.hypot(A[0] - B[0], A[1] - B[1]);
  const p = a + b + c;
  const area = Math.abs((B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1])) / 2;
  if (p < 1e-9 || area < 1e-9) return q;
  const ix = (a * A[0] + b * B[0] + c * C[0]) / p, iy = (a * A[1] + b * B[1] + c * C[1]) / p;
  const k = 1 + d / ((2 * area) / p);
  return q.map(([x, y]) => [ix + (x - ix) * k, iy + (y - iy) * k]);
}
