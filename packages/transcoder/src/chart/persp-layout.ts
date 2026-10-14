/**
 * 透视三维图（cat3d-persp.ts）的箱体比例和在绘图区里的位置（PowerPoint 实测，COM 生成 40 多种
 * 行列数、深度、透视、视角、尺寸的探针图，拟合墙上网格线的位置和端点，误差 0.1~0.3 像素）。
 */
import { cameraDistance, cameraOf, type Placement } from './camera3d';
import { PAD, SIDE_LABEL_PAD, sideGap, topForLabel } from './layout';
import type { Rect, View3D } from './model';

/**
 * 箱体的高（以分类宽为单位，再乘内框的高宽比）：⌊(分类数 + 系列数) / 2⌋（实测：COM 生成 2~8 个分类、1~6 个系列的
 * 三维折线图、面积图，拟合出的高都是整数个分类宽；堆积的一例是 ⌈ ⌉）
 */
export function heightCells(nCat: number, nSer: number, stacked: boolean): number {
  const h = (nCat + nSer) / 2;
  return Math.max(1, stacked ? Math.ceil(h) : Math.floor(h));
}

/** 标签占的地方（像素）：数值标签最宽和字号、分类标签字号和高度带、首尾分类标签宽（分类在端点上时）、系列标签最宽 */
export interface LabelRoom { val: number; valSize: number; cat: number; catBand: number; ends?: [number, number]; ser: number; serRight: boolean }

/** 实测（COM 读的绘图区内框 + 导出图拟合）：右边系列标签让出的空间、投影外框四周留的空、外框中心上移的系数（× perspective，像素） */
const SER_ROOM = 3.1, FIT_MARGIN = 12.6, LIFT = 0.15;

/**
 * 箱体在绘图区里的位置：
 *   - 内框 = 绘图区去掉标签：左、上、下和平面的分类轴图一样（layout.ts），系列标签在轴外侧时那一边让出标签宽 + 3.1；
 *   - 投影中心在内框中心，箱体在相机坐标里平移；缩放让投影后的箱体外框放进内框、四周各留 6.3；
 *   - 外框横向居中，纵向中心在内框中心上方 0.15 × perspective × (45° − 俯角) / 30° 像素（俯角 15°、30°、45° 的探针图拟合；
 *     20 种视角、尺寸、行列数的探针图和我们的输出对照，整体位移多数在 ±3 像素以内）。
 */
export function innerRect(area: Rect, room: LabelRoom): Rect {
  const val = room.val > 0;
  let left = val ? (area.left === PAD ? SIDE_LABEL_PAD : area.left) + room.val + sideGap(room.valSize) : area.left;
  let right = area.right - (room.ser && room.serRight ? room.ser + SER_ROOM : 0);
  if (room.ser && !room.serRight) left = Math.max(left, area.left + room.ser + SER_ROOM);
  // 分类标签在端点上（面积图）：首尾标签各留半个宽度
  if (room.ends) { left = Math.max(left, area.left + room.ends[0] / 2); right = Math.min(right, area.right - room.ends[1] / 2); }
  return { left, right, top: val ? Math.max(area.top, topForLabel(room.valSize)) : area.top, bottom: area.bottom - (room.cat ? room.catBand : 0) };
}

/** 投影后箱体八个角的外框 */
function boxBounds(view: View3D, H: number, D: number, pl: Placement) {
  const cam = cameraOf(view, pl);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const x of [-0.5, 0.5]) for (const y of [-H / 2, H / 2]) for (const z of [-D / 2, D / 2]) {
    const [a, b] = cam.pt([x, y, z]);
    x0 = Math.min(x0, a); x1 = Math.max(x1, a); y0 = Math.min(y0, b); y1 = Math.max(y1, b);
  }
  return { x0, x1, y0, y1 };
}

export function placeBox(view: View3D, H: number, D: number, inner: Rect): Placement {
  const cx = (inner.left + inner.right) / 2, cy = (inner.top + inner.bottom) / 2;
  const iw = inner.right - inner.left, ih = inner.bottom - inner.top;
  // 缩放、相机距离（按像素定）、偏移互相依赖：迭代几次
  let s = 1, L = 0, ox = 0, oy = 0;
  for (let it = 0; it < 6; it++) {
    const u = boxBounds(view, H, D, { cx: 0, cy: 0, s: 1, ox, oy, L });
    s = Math.max(1e-6, Math.min((iw - FIT_MARGIN) / Math.max(1e-6, u.x1 - u.x0), (ih - FIT_MARGIN) / Math.max(1e-6, u.y1 - u.y0)));
    L = cameraDistance(view, ih, s);
    const b = boxBounds(view, H, D, { cx, cy, s, ox, oy, L });
    ox -= ((b.x0 + b.x1) / 2 - cx) / s;
    oy += ((b.y0 + b.y1) / 2 - (cy - LIFT * view.perspective * Math.max(0, (45 - view.rotX) / 30))) / s;
  }
  return { cx, cy, s, ox, oy, L };
}
