/**
 * EMF / WMF 的图案画刷（EMF 的 CREATEDIBPATTERNBRUSHPT、CREATEMONOBRUSH，WMF 的 DIBCREATEPATTERNBRUSH）：剪贴画常用 8×8 的
 * 抖动图案填色。PowerPoint 按设备像素平铺图案，转出来的 SVG 不知道设备像素多大，这里用图案的平均色填（实测见 SPEC 第 7 节，
 * wmf-pattern-brush 用例）。
 * 单色图案（1 位、不带颜色表的）画的时候才定颜色：0 用文字色、1 用背景色——记下 1 占多少，画的时候按当时的两种颜色混
 */
import { decodeBmp } from './bmp';

const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0');

/** BMP（调色板已经在里面）-> 平均色；解不开时 undefined */
export function bmpAverage(bmp: Uint8Array): string | undefined {
  const img = decodeBmp(bmp);
  if (!img || 'embedded' in img || !img.width || !img.height) return undefined;
  const sum = [0, 0, 0];
  const px = img.data, n = img.width * img.height;
  for (let i = 0; i < px.length; i += 4) { sum[0] += px[i]; sum[1] += px[i + 1]; sum[2] += px[i + 2]; }
  return `#${sum.map((v) => hex(v / n)).join('')}`;
}

/** 1 位的像素里 1 占的比例；stride 是每行字节数（DIB 按 4 字节对齐，WMF 的老式位图按 2 字节） */
export function monoShare(bits: Uint8Array, w: number, h: number, stride = ((w + 31) >> 5) * 4): number {
  let ones = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) if ((bits[y * stride + (x >> 3)] >> (7 - (x & 7))) & 1) ones++;
  }
  return w * h ? ones / (w * h) : 0.5;
}

/** 单色图案的颜色：文字色和背景色按 1 的比例混 */
export function monoColor(textColor: string, bkColor: string, mono: number): string {
  const c = (s: string, k: number) => parseInt(s.slice(1 + k * 2, 3 + k * 2), 16);
  return `#${[0, 1, 2].map((k) => hex(c(textColor, k) * (1 - mono) + c(bkColor, k) * mono)).join('')}`;
}
