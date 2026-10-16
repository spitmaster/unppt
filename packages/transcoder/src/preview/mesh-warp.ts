/**
 * 透视投影的图片（style/perspective.ts 按网格切成三角形、每个三角形一份内容）在整页图里只画一次：浏览器只画剪裁范围里的像素，
 * resvg 每个三角形都把整张图片连同阴影等效果完整画一层再剪——样本里一页 128 个三角形、带 29 像素模糊的阴影，要画 25~30 秒。
 * 准备时（warpMeshes）把一组内容相同的三角形换成一张图片，内容交给绘制单独画一次成位图；绘制时（warpPixels）按同样的分段仿射
 * 贴到投影后的位置：每个像素找所在的三角形、反算回内容上的位置，双线性取样。只用于整页图，不改播放器产物
 */

export interface MeshWarp {
  /** 三角形：剪裁多边形（组坐标，三个点 x y x y x y）和内容（局部坐标）到组坐标的仿射 matrix(a b c d e f) */
  tris: { q: number[]; m: number[] }[];
  /** 内容位图覆盖的局部坐标范围 x y w h */
  src: number[];
  /** 输出图片覆盖的组坐标范围 x y w h，和它的像素大小 */
  dst: number[];
  width: number;
  height: number;
}

/** 输出图片按页面缩放的几倍画（组合可能还有放大），以及位图边长的上限 */
const OVERSAMPLE = 2, MAX_SIDE = 2048, MAX_SRC = 4096;

const TRI = /<g clip-path="url\(#([^)"]+)\)"><g transform="matrix\(([^)]+)\)">/y;

/**
 * svg 里的透视网格换成一张图片；scale 是页面的缩放（整页图像素 / 用户单位）。
 * raster(内容 SVG, 位图宽度, 贴法) 交给绘制单独画，返回页面里引用它的地址
 */
export function warpMeshes(svg: string, scale: number, raster: (content: string, width: number, warp: MeshWarp) => string): string {
  if (!svg.includes('><g transform="matrix(')) return svg;
  const polys = new Map<string, number[]>();
  for (const m of svg.matchAll(/<clipPath id="([^"]+)"><polygon points="([^"]+)"\/><\/clipPath>/g)) {
    const pts = m[2].trim().split(/[\s,]+/).map(Number);
    if (pts.length === 6 && pts.every(Number.isFinite)) polys.set(m[1], pts);
  }
  if (!polys.size) return svg;
  const root = /^<svg\b[^>]*>/.exec(svg)?.[0] ?? '';
  const ns = [...root.matchAll(/\sxmlns:\w+="[^"]*"/g)].map((m) => m[0]).join('');
  const defs = [...svg.matchAll(/<defs>[\s\S]*?<\/defs>/g)].map((m) => m[0]).join('');
  const out: string[] = [];
  let last = 0;
  for (let i = svg.indexOf('<g clip-path="url(#'); i >= 0; i = svg.indexOf('<g clip-path="url(#', i + 1)) {
    if (i < last) continue;
    const run: { q: number[]; m: number[] }[] = [];
    let content: string | undefined;
    let at = i;
    for (;;) {
      TRI.lastIndex = at;
      const t = TRI.exec(svg);
      const q = t && polys.get(t[1]);
      const m = t?.[2].trim().split(/\s+/).map(Number);
      if (!t || !q || !m || m.length !== 6 || !m.every(Number.isFinite)) break;
      const end = groupEnd(svg, at);
      if (end < 0 || svg.slice(end - 8, end) !== '</g></g>') break;
      const c = svg.slice(at + t[0].length, end - 8);
      if (content !== undefined && c !== content) break;
      content = c;
      run.push({ q, m });
      at = end;
    }
    if (run.length < 2 || content === undefined) continue;
    const warp = plan(run, scale);
    if (!warp) continue;
    const [sx, sy, sw, sh] = warp.src;
    const width = Math.min(MAX_SRC, Math.max(16, Math.ceil(sw * (warp.width / warp.dst[2]) * maxScale(run))));
    // 根元素的宽高就是位图大小（发光外扩拆两遍时按它算缩放，morphology.ts）
    const href = raster(`<svg xmlns="http://www.w3.org/2000/svg"${ns} viewBox="${sx} ${sy} ${sw} ${sh}" width="${width}" height="${+(width * sh / sw).toFixed(2)}">${defs}${content}</svg>`, width, warp);
    const [dx, dy, dw, dh] = warp.dst;
    out.push(svg.slice(last, i), `<image href="${href}" x="${dx}" y="${dy}" width="${dw}" height="${dh}" preserveAspectRatio="none"/>`);
    last = at;
  }
  if (!out.length) return svg;
  out.push(svg.slice(last));
  return out.join('');
}

/** 从 svg[at] 的 <g 开始，到和它配对的 </g> 之后的位置；配不上返回 -1 */
function groupEnd(svg: string, at: number): number {
  const re = /<g\b[^>]*>|<\/g>/g;
  re.lastIndex = at;
  let depth = 0;
  for (let m = re.exec(svg); m; m = re.exec(svg)) {
    if (m[0] === '</g>') depth--;
    else if (!m[0].endsWith('/>')) depth++;
    if (depth === 0) return m.index + m[0].length;
  }
  return -1;
}

/** 三角形的范围：组坐标的外框（输出图片），反算回局部坐标的外框（内容位图） */
function plan(run: { q: number[]; m: number[] }[], scale: number): MeshWarp | undefined {
  let gx0 = Infinity, gy0 = Infinity, gx1 = -Infinity, gy1 = -Infinity, lx0 = Infinity, ly0 = Infinity, lx1 = -Infinity, ly1 = -Infinity;
  for (const { q, m } of run) {
    const inv = invert(m);
    if (!inv) return undefined;
    for (let k = 0; k < 6; k += 2) {
      const x = q[k], y = q[k + 1];
      gx0 = Math.min(gx0, x); gy0 = Math.min(gy0, y); gx1 = Math.max(gx1, x); gy1 = Math.max(gy1, y);
      const lx = inv[0] * x + inv[2] * y + inv[4], ly = inv[1] * x + inv[3] * y + inv[5];
      lx0 = Math.min(lx0, lx); ly0 = Math.min(ly0, ly); lx1 = Math.max(lx1, lx); ly1 = Math.max(ly1, ly);
    }
  }
  const r = (v: number) => +v.toFixed(3);
  const dst = [Math.floor(gx0), Math.floor(gy0), Math.ceil(gx1) - Math.floor(gx0), Math.ceil(gy1) - Math.floor(gy0)];
  const src = [r(lx0), r(ly0), r(lx1 - lx0), r(ly1 - ly0)];
  if (!(dst[2] > 0 && dst[3] > 0 && src[2] > 0 && src[3] > 0)) return undefined;
  const k = Math.min(scale * OVERSAMPLE, MAX_SIDE / Math.max(dst[2], dst[3]));
  return { tris: run, src, dst, width: Math.max(1, Math.ceil(dst[2] * k)), height: Math.max(1, Math.ceil(dst[3] * k)) };
}

/** 局部坐标的一个单位在组坐标里最长有多长（内容位图至少要这么密） */
function maxScale(run: { m: number[] }[]): number {
  return Math.max(1e-3, ...run.map(({ m }) => Math.max(Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3]))));
}

function invert(m: number[]): number[] | undefined {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return undefined;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/**
 * 内容位图（预乘透明度的 RGBA，pw×ph，覆盖 warp.src）按三角形贴到输出图片（warp.width×warp.height，覆盖 warp.dst）：
 * 返回不预乘的 RGBA（编 PNG 用）
 */
export function warpPixels(px: Uint8Array, pw: number, ph: number, warp: MeshWarp): Uint8Array {
  const { width: W, height: H } = warp;
  const [dx, dy, dw, dh] = warp.dst, [sx, sy, sw, sh] = warp.src;
  const kx = pw / sw, ky = ph / sh;
  const tris = warp.tris.map(({ q, m }) => ({ q, inv: invert(m)! }));
  // 按格子分桶：每个格子记下外框和它相交的三角形
  const G = 16;
  const cells: number[][] = Array.from({ length: G * G }, () => []);
  const cx = (x: number) => Math.min(G - 1, Math.max(0, Math.floor(((x - dx) / dw) * G)));
  const cy = (y: number) => Math.min(G - 1, Math.max(0, Math.floor(((y - dy) / dh) * G)));
  tris.forEach(({ q }, t) => {
    const x0 = cx(Math.min(q[0], q[2], q[4])), x1 = cx(Math.max(q[0], q[2], q[4]));
    const y0 = cy(Math.min(q[1], q[3], q[5])), y1 = cy(Math.max(q[1], q[3], q[5]));
    for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) cells[j * G + i].push(t);
  });
  const out = new Uint8Array(W * H * 4);
  for (let v = 0; v < H; v++) {
    const gy = dy + ((v + 0.5) * dh) / H;
    for (let u = 0; u < W; u++) {
      const gx = dx + ((u + 0.5) * dw) / W;
      const t = cells[cy(gy) * G + cx(gx)].find((k) => inside(tris[k].q, gx, gy));
      if (t === undefined) continue;
      const iv = tris[t].inv;
      const rx = (iv[0] * gx + iv[2] * gy + iv[4] - sx) * kx - 0.5, ry = (iv[1] * gx + iv[3] * gy + iv[5] - sy) * ky - 0.5;
      sample(px, pw, ph, rx, ry, out, (v * W + u) * 4);
    }
  }
  return out;
}

/** 点在三角形里（含边上） */
function inside(q: number[], x: number, y: number): boolean {
  const e = (ax: number, ay: number, bx: number, by: number) => (bx - ax) * (y - ay) - (by - ay) * (x - ax);
  const a = e(q[0], q[1], q[2], q[3]), b = e(q[2], q[3], q[4], q[5]), c = e(q[4], q[5], q[0], q[1]);
  return (a >= 0 && b >= 0 && c >= 0) || (a <= 0 && b <= 0 && c <= 0);
}

/** 预乘透明度的位图上双线性取样，写成不预乘的颜色；图外按透明 */
function sample(px: Uint8Array, w: number, h: number, x: number, y: number, out: Uint8Array, o: number): void {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  let r = 0, g = 0, b = 0, a = 0;
  for (let j = 0; j < 2; j++) {
    const yy = y0 + j;
    if (yy < 0 || yy >= h) continue;
    const wy = j ? fy : 1 - fy;
    for (let i = 0; i < 2; i++) {
      const xx = x0 + i;
      if (xx < 0 || xx >= w) continue;
      const wt = wy * (i ? fx : 1 - fx);
      const p = (yy * w + xx) * 4;
      r += px[p] * wt; g += px[p + 1] * wt; b += px[p + 2] * wt; a += px[p + 3] * wt;
    }
  }
  if (a <= 0) return;
  out[o] = Math.min(255, Math.round((r * 255) / a));
  out[o + 1] = Math.min(255, Math.round((g * 255) / a));
  out[o + 2] = Math.min(255, Math.round((b * 255) / a));
  out[o + 3] = Math.round(a);
}
