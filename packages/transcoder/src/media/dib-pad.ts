/**
 * EMF 的 STRETCHDIBITS 按 PowerPoint 的画法（dib-blit.ts 的 linear）：位图内容左移、上移半个像素，源框露出位图右边、下边的部分
 * 用镜像的像素补——边上那一列 / 行重复一次再往里镜像（实测 emf-stretchdibits-pad：源框比 201 像素宽的位图宽 3 像素，
 * 第 201、202 列都是第 200 列的黑线）。这里按位图做出补边用的小图：右边一条（含右下角）、下边一条。
 * 小图各往位图里多带几列 / 行原样的像素、先画，位图画在上面：两张图的接缝落在设备像素中间时不透出底色
 */
import { decodeBmp, rgbaToBmp } from './bmp';
import type { BitmapSource } from './dib-blit';

/** 补边的小图（BMP）和它的位置、大小（按位图像素） */
export interface Pad { bmp: Uint8Array; x: number; y: number; w: number; h: number }

/** 往位图里多带的列 / 行数：缩小显示时 1 个位图像素不到 1 个设备像素，多带几个才盖得住接缝 */
const OVERLAP = 4;

export function edgePads(bmp: Uint8Array, s: BitmapSource): Pad[] {
  // 内容左移半个像素后位图占 [-0.5, bw - 0.5]：源框右边、下边露出多少个像素
  const kx = Math.ceil(s.x + s.w + 0.5 - s.bw), ky = Math.ceil(s.y + s.h + 0.5 - s.bh);
  if (kx <= 0 && ky <= 0) return [];
  const img = decodeBmp(bmp);
  if (!img || 'embedded' in img || img.width !== s.bw || img.height !== s.bh) return [];
  const { width: bw, height: bh, data } = img;
  // 位图外第 i 个像素（从 0 数）取倒数第 i + 1 个
  const m = (v: number, n: number) => Math.min(n - 1, Math.max(0, v < n ? v : 2 * n - 1 - v));
  const cut = (x0: number, y0: number, w: number, h: number): Pad => {
    const px = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      const row = m(y0 + y, bh) * bw;
      for (let x = 0; x < w; x++) px.set(data.subarray((row + m(x0 + x, bw)) * 4, (row + m(x0 + x, bw)) * 4 + 4), (y * w + x) * 4);
    }
    return { bmp: rgbaToBmp(w, h, px), x: x0, y: y0, w, h };
  };
  const ox = Math.min(OVERLAP, bw), oy = Math.min(OVERLAP, bh);
  const pads: Pad[] = [];
  if (kx > 0) pads.push(cut(bw - ox, 0, ox + kx, bh + Math.max(ky, 0)));
  if (ky > 0) pads.push(cut(0, bh - oy, bw, oy + ky));
  return pads;
}
