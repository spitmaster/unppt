/**
 * 转动后的轮廓的外接矩形：几何先按形状翻转、再绕形状中心转 rot 度后，各条有填充的路径占的范围（形状坐标；曲线、圆弧按点采样）。
 * 不跟着形状转的图片 / 渐变填充正着铺在这个矩形里（实测样本：切掉一角的自定义形状转 45°，图片按转动后轮廓的范围铺，不按形状框）。
 */
import { walkGeometry, type GeomDef, type PathSink } from './geometry';

export interface Bounds { x: number; y: number; w: number; h: number }

const STEPS = 16;

class BoundsSink implements PathSink {
  minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
  private x = 0;
  private y = 0;
  constructor(private map: (x: number, y: number) => [number, number]) {}
  private add(x: number, y: number) {
    const [a, b] = this.map(x, y);
    this.minX = Math.min(this.minX, a); this.maxX = Math.max(this.maxX, a);
    this.minY = Math.min(this.minY, b); this.maxY = Math.max(this.maxY, b);
    this.x = x; this.y = y;
  }
  move(x: number, y: number) { this.add(x, y); }
  line(x: number, y: number) { this.add(x, y); }
  cubic(x1: number, y1: number, x2: number, y2: number, x: number, y: number) {
    const x0 = this.x, y0 = this.y;
    for (let i = 1; i <= STEPS; i++) {
      const t = i / STEPS, u = 1 - t;
      this.add(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y);
    }
  }
  quad(x1: number, y1: number, x: number, y: number) {
    const x0 = this.x, y0 = this.y;
    for (let i = 1; i <= STEPS; i++) {
      const t = i / STEPS, u = 1 - t;
      this.add(u * u * x0 + 2 * u * t * x1 + t * t * x, u * u * y0 + 2 * u * t * y1 + t * t * y);
    }
  }
  arc(ox: number, oy: number, wR: number, hR: number, t1: number, dt: number) {
    const n = Math.max(STEPS, Math.ceil((Math.abs(dt) / (Math.PI * 2)) * 64));
    for (let i = 1; i <= n; i++) { const t = t1 + (dt * i) / n; this.add(ox + wR * Math.cos(t), oy + hR * Math.sin(t)); }
  }
  close() {}
}

/** all：只描边不填充的路径（线形标注的引线等）也算 */
export function turnedBounds(def: GeomDef, w: number, h: number, av: Map<string, string>, rot: number, flipH?: boolean, flipV?: boolean, all = false): Bounds | undefined {
  const a = (rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), cx = w / 2, cy = h / 2;
  const sinks: BoundsSink[] = [];
  walkGeometry(def, w, h, av, (i) => {
    const sink = new BoundsSink((x, y) => {
      const dx = (flipH ? w - x : x) - cx, dy = (flipV ? h - y : y) - cy;
      return [cx + dx * c - dy * s, cy + dx * s + dy * c];
    });
    if (all || def.paths[i].fill !== 'none') sinks.push(sink);
    return sink;
  });
  const minX = Math.min(...sinks.map((k) => k.minX)), maxX = Math.max(...sinks.map((k) => k.maxX));
  const minY = Math.min(...sinks.map((k) => k.minY)), maxY = Math.max(...sinks.map((k) => k.maxY));
  if (!(maxX > minX && maxY > minY)) return undefined;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * 轮廓伸到形状框外时，框和轮廓合起来的范围（形状坐标，已按翻转）；没伸出去时 undefined。效果滤镜按它定区域
 * （标注的尾巴被调整点拉到框外很远时，按框算的滤镜区域会把尾巴裁掉）
 */
export function outlineExtent(def: GeomDef, w: number, h: number, av: Map<string, string>, flipH?: boolean, flipV?: boolean): Bounds | undefined {
  const b = turnedBounds(def, w, h, av, 0, flipH, flipV, true);
  if (!b || (b.x >= -0.5 && b.y >= -0.5 && b.x + b.w <= w + 0.5 && b.y + b.h <= h + 0.5)) return undefined;
  const x0 = Math.min(0, b.x), y0 = Math.min(0, b.y), x1 = Math.max(w, b.x + b.w), y1 = Math.max(h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
