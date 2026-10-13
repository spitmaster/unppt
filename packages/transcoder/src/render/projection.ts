/**
 * 透视相机下形状、图片的投影（形状自己的三维旋转，或者所在 SmartArt 三维场景的相机）。
 *   - 形状：轮廓逐点投影（精确，没有接缝）；渐变、图片填充和文字用投影的局部仿射近似（fillAffine、textAffine）；
 *   - 图片：按网格三角形透视（style/perspective.ts），用 box 局部坐标里的投影函数 base。
 * 先翻转、再在框里转动、最后投影（和 boxTransform 的顺序一样；文字不跟着翻转）。
 */
import { perspectiveProjector } from '../style/camera';
import type { PointMap } from '../geometry/geometry';
import type { SlideContext } from '../model/model';
import type { XEl } from '../io/xml';
import { n2, type SvgDoc } from '../common/svg';
import type { Box } from './box';

export interface ShapeProjection {
  /** 用的是哪个三维场景的相机（形状自己的，或者 SmartArt 场景的） */
  camera: XEl;
  /** 几何上的点（翻转前的局部坐标）-> 框里投影后的位置 */
  map: PointMap;
  /** 渐变、图片填充（带翻转）和文字（不翻转）的仿射近似，SVG transform */
  fillAffine: string;
  textAffine: string;
}

/** 框里（局部坐标，转动前）一点投影后的位置：形状自己的透视相机，或者 SmartArt 场景的透视相机；都没有时 undefined */
export function baseProjection(box: Box, scene3d: XEl | undefined, scene: SlideContext['scene'], slideW: number): { camera: XEl; base: PointMap } | undefined {
  const own = perspectiveProjector(scene3d, box.w, box.h, slideW);
  if (own) return { camera: scene3d!, base: own };
  if (!scene) return undefined;
  const sp = perspectiveProjector(scene.scene3d, scene.w, scene.h, slideW);
  if (!sp) return undefined;
  return {
    camera: scene.scene3d,
    base: (x, y) => {
      const [X, Y] = sp(x + box.x, y + box.y);
      return [X - box.x, Y - box.y];
    },
  };
}

export function shapeProjection(box: Box, scene3d: XEl | undefined, scene: SlideContext['scene'], slideW: number): ShapeProjection | undefined {
  const bp = baseProjection(box, scene3d, scene, slideW);
  if (!bp) return undefined;
  const { base, camera } = bp;
  const t = (box.rot * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t), cx = box.w / 2, cy = box.h / 2;
  const textMap: PointMap = (x, y) => base(cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c);
  const map: PointMap = (x, y) => textMap(box.flipH ? box.w - x : x, box.flipV ? box.h - y : y);
  return { camera, map, fillAffine: fitMatrix(map, box.w, box.h), textAffine: fitMatrix(textMap, box.w, box.h) };
}

/** 投影后形状外框（沿边和中线取点）的范围 */
export function projectedBounds(map: PointMap, w: number, h: number): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
    const [X, Y] = map((w * i) / 8, (h * j) / 8);
    x0 = Math.min(x0, X); y0 = Math.min(y0, Y); x1 = Math.max(x1, X); y1 = Math.max(y1, Y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** 点映射在 w×h 范围里的最小二乘仿射近似（四个角、四边中点和中心），写成 matrix(...) */
export function fitMatrix(map: PointMap, w: number, h: number): string {
  const pts: [number, number][] = [];
  for (const fx of [0, 0.5, 1]) for (const fy of [0, 0.5, 1]) pts.push([fx * w, fy * h]);
  // 以中心为原点解 [a c; b d]，再算平移
  const mx = w / 2, my = h / 2;
  let sxx = 0, sxy = 0, syy = 0, ux = 0, uy = 0, vx = 0, vy = 0, px = 0, py = 0;
  const q = pts.map(([x, y]) => map(x, y));
  for (const [X, Y] of q) { px += X; py += Y; }
  px /= q.length; py /= q.length;
  pts.forEach(([x, y], i) => {
    const dx = x - mx, dy = y - my, X = q[i][0] - px, Y = q[i][1] - py;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    ux += X * dx; uy += X * dy; vx += Y * dx; vy += Y * dy;
  });
  const det = sxx * syy - sxy * sxy || 1;
  const a = (ux * syy - uy * sxy) / det, c = (uy * sxx - ux * sxy) / det;
  const b = (vx * syy - vy * sxy) / det, d = (vy * sxx - vx * sxy) / det;
  const e = px - (a * mx + c * my), f = py - (b * mx + d * my);
  const r = (v: number) => +v.toFixed(5);
  return `matrix(${r(a)} ${r(b)} ${r(c)} ${r(d)} ${r(e)} ${r(f)})`;
}

/**
 * 投影后的一条路径：纯色直接填投影后的轮廓；渐变、图片等填充（局部坐标里定义的）按仿射近似画一块更大的矩形，
 * 用投影后的轮廓剪裁；描边画在投影后的轮廓上
 */
export function projectedPath(pd: string, box: Box, fa: string, sa: string, evenodd: string, fillAffine: string, doc: SvgDoc): string {
  let out = '';
  if (fa !== ' fill="none"') {
    if (fa.includes('url(')) {
      const id = doc.id('c');
      doc.addDef(`<clipPath id="${id}"><path d="${pd}"${evenodd ? ' clip-rule="evenodd"' : ''}/></clipPath>`);
      const m = Math.max(box.w, box.h) / 2;
      out += `<g clip-path="url(#${id})"><rect x="${n2(-m)}" y="${n2(-m)}" width="${n2(box.w + 2 * m)}" height="${n2(box.h + 2 * m)}" transform="${fillAffine}"${fa}/></g>`;
    } else out += `<path d="${pd}"${fa} stroke="none"${evenodd}/>`;
  }
  if (sa !== ' stroke="none"') out += `<path d="${pd}" fill="none"${sa}/>`;
  return out;
}
