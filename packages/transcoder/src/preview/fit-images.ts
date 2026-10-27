/**
 * 位图先按整页图里实际画的大小（drawn-size.ts）低通缩小，再交给 resvg：resvg 缩小位图只按周围几个像素取样，
 * 画得比原图小很多时照片发花、出摩尔纹，截图里的细线、小字断掉；PowerPoint 缩小时把覆盖到的像素都平均进去。只影响整页图，播放器由浏览器缩放。
 *   - JPEG 用 libjpeg-turbo 全尺寸解码（media/jpeg-turbo.ts，比 resvg 自己解还快）再按整数倍取块平均；它解不了的（四分量、坏文件）
 *     用自研的 media/jpeg.ts 按 1/2、1/4、1/8 里最小的够用的比例解（块内取平均）；PNG 边解压边按整数倍缩（media/png-shrink.ts，
 *     不在内存里展开整张原图）。整数倍都留两倍以上给最后一步：再按小数比例缩到目标大小（downsample，透明的按预乘透明度平均）；
 *   - 结果编成不压缩的 PNG（只给 resvg 读，省掉压缩的时间）；GIF 等别的格式、解不了的不缩，照原样交给 resvg。
 * 画的大小没比原图小到 FIT_RATIO 以下的不缩：差不多大时 resvg 的双三次取样够用，再缩一遍反而多一次重采样。
 */
import { imageInfo } from '../media/image-info';
import { decodeJpeg } from '../media/jpeg';
import { decodeJpegTurbo } from '../media/jpeg-turbo';
import { encodeStored } from '../media/png';
import { shrinkPngPixels } from '../media/png-shrink';
import type { DrawnUse } from './drawn-size';

/** 画的大小（宽、高里比例小的那个）在原图的这个比例以下才缩 */
export const FIT_RATIO = 0.7;

/** 各处用法 -> 原图要缩到多大（像素，取各处里最大的）；不用缩时 undefined */
export function fitSize(width: number, height: number, uses: DrawnUse[]): { w: number; h: number } | undefined {
  if (!(width > 0 && height > 0) || !uses.length) return undefined;
  let tw = 0, th = 0;
  for (const u of uses) {
    let sx = u.w / width, sy = u.h / height;
    if (u.fit !== 'none') sx = sy = u.fit === 'meet' ? Math.min(sx, sy) : Math.max(sx, sy);
    tw = Math.max(tw, sx * width);
    th = Math.max(th, sy * height);
  }
  // 页面里的尺寸写到 0.01，画的大小算出来常常比整数多一点点（200.0025）：不为这一点多缩出一列
  const w = Math.max(1, Math.min(width, Math.ceil(tw - 0.01))), h = Math.max(1, Math.min(height, Math.ceil(th - 0.01)));
  return Math.min(w / width, h / height) <= FIT_RATIO ? { w, h } : undefined;
}

/** 原图要缩到多大（读文件头里的尺寸）；不用缩、不是 PNG / JPEG 时 undefined */
export function fitTarget(b: Uint8Array, uses: DrawnUse[]): { w: number; h: number } | undefined {
  const jpeg = b[0] === 0xff && b[1] === 0xd8, png = b[0] === 0x89 && b[1] === 0x50;
  const info = jpeg || png ? imageInfo(b) : undefined;
  return info && fitSize(info.width, info.height, uses);
}

/**
 * 先整数倍缩小时，最后一步按小数比例平均的每个输出像素至少要覆盖这么多个源像素：整数倍的方块和图里的细纹周期对不上时
 * 会拍出粗条纹（1 像素竖线按 5 倍缩、再按 1.2 倍缩出明暗相间的竖条），留两倍以上给最后一步就抹平了
 */
const LAST_STEP = 2;

/** RGB 按整数倍 k 取块平均（右边、下边不满一块的按实际像素数） */
function boxShrink(img: { width: number; height: number; data: Uint8Array }, k: number): { width: number; height: number; data: Uint8Array } {
  const { width: w, height: h, data: src } = img;
  const ow = Math.ceil(w / k), oh = Math.ceil(h / k);
  const out = new Uint8Array(ow * oh * 3), acc = new Float64Array(ow * 3);
  for (let oy = 0; oy < oh; oy++) {
    const y0 = oy * k, y1 = Math.min(h, y0 + k);
    for (let y = y0; y < y1; y++) {
      for (let x = 0, i = y * w * 3, o = 0, c = 0; x < w; x++, i += 3) {
        acc[o] += src[i]; acc[o + 1] += src[i + 1]; acc[o + 2] += src[i + 2];
        if (++c === k) { c = 0; o += 3; }
      }
    }
    for (let ox = 0, o = 0, t = oy * ow * 3; ox < ow; ox++, o += 3, t += 3) {
      const n = (y1 - y0) * (Math.min(w, ox * k + k) - ox * k);
      out[t] = Math.round(acc[o] / n); out[t + 1] = Math.round(acc[o + 1] / n); out[t + 2] = Math.round(acc[o + 2] / n);
    }
    acc.fill(0);
  }
  return { width: ow, height: oh, data: out };
}

/** 原图（PNG / JPEG 字节）缩到 t（fitTarget 算的），返回不压缩的 PNG；缩不了时 undefined */
export async function fitImage(b: Uint8Array, t: { w: number; h: number }): Promise<Uint8Array | undefined> {
  const info = imageInfo(b);
  if (!info) return undefined;
  const jpeg = b[0] === 0xff && b[1] === 0xd8, png = b[0] === 0x89 && b[1] === 0x50;
  if (jpeg) {
    // libjpeg-turbo 解不了时按 1/2、1/4、1/8 解码（块内的低通），解出来的长边至少是目标在两个方向上的比例的 LAST_STEP 倍
    const need = Math.ceil(Math.max(t.w / info.width, t.h / info.height) * Math.max(info.width, info.height) * LAST_STEP);
    let img = (await decodeJpegTurbo(b)) ?? decodeJpeg(b, need);
    if (!img) return undefined;
    // 全尺寸解出来的、比目标大很多的先按整数倍取块平均（每个像素只加一次，比帐篷权重省得多），同样留 LAST_STEP 倍给最后一步
    const k = Math.floor(Math.min(img.width / t.w, img.height / t.h) / LAST_STEP);
    if (k > 1) img = boxShrink(img, k);
    return encodeStored(downsample(img.data, img.width, img.height, 3, t.w, t.h), t.w, t.h, 3);
  }
  if (png) {
    const k = Math.max(1, Math.floor(Math.min(info.width / t.w, info.height / t.h) / LAST_STEP));
    const img = await shrinkPngPixels(b, k).catch(() => undefined);
    if (!img) return undefined;
    if (!img.alpha) {
      const rgb = new Uint8Array(img.width * img.height * 3);
      for (let i = 0, j = 0; j < rgb.length; i += 4, j += 3) { rgb[j] = img.data[i]; rgb[j + 1] = img.data[i + 1]; rgb[j + 2] = img.data[i + 2]; }
      return encodeStored(downsample(rgb, img.width, img.height, 3, t.w, t.h), t.w, t.h, 3);
    }
    return encodeStored(downsample(img.data, img.width, img.height, 4, t.w, t.h), t.w, t.h, 4);
  }
  return undefined;
}

/**
 * 每个输出像素取哪些源像素、权重多少：三角形（帐篷）权重，以输出像素中心为中心、半宽是一个输出像素对应的源宽度——
 * 等于先按面积平均、再和相邻像素各混一半。只按面积平均（方块）时，细纹的周期和方块宽度对不上会拍出明暗相间的条纹
 * （1 像素竖线正好缩成 1/3：每 3 列里交替是 2 黑 1 白、1 黑 2 白）
 */
function spans(src: number, dst: number): { start: Int32Array; count: Int32Array; weights: Float64Array; stride: number } {
  const scale = src / dst, stride = Math.ceil(2 * scale) + 2;
  const start = new Int32Array(dst), count = new Int32Array(dst), weights = new Float64Array(dst * stride);
  for (let i = 0; i < dst; i++) {
    const c = (i + 0.5) * scale;
    const s = Math.max(0, Math.ceil(c - scale - 0.5)), e = Math.min(src - 1, Math.floor(c + scale - 0.5));
    let n = 0, sum = 0;
    for (let p = s; p <= e && n < stride; p++, n++) {
      const w = Math.max(0, 1 - Math.abs(p + 0.5 - c) / scale);
      weights[i * stride + n] = w;
      sum += w;
    }
    for (let k = 0; k < n; k++) weights[i * stride + k] /= sum || 1;
    start[i] = s;
    count[i] = n;
  }
  return { start, count, weights, stride };
}

/**
 * 按小数比例缩小（每个输出像素按 spans 的帐篷权重取源像素的加权平均，横竖分开做）。ch 是 4 时第 4 个通道是透明度，颜色按预乘透明度平均
 * （透明像素的颜色不渗到旁边）。逐行处理：每行源像素横向缩好后加到用到它的输出行上，只存几行累加值（按输出行号轮流用）
 */
export function downsample(src: Uint8Array, sw: number, sh: number, ch: 3 | 4, tw: number, th: number): Uint8Array {
  const xs = spans(sw, tw), ys = spans(sh, th);
  const out = new Uint8Array(tw * th * ch);
  const n = tw * ch;
  const row = new Float64Array(n);
  // 一个源行最多加到 ys.stride 个输出行上：累加值按输出行号对 ring 取余轮流用
  const ring = ys.stride + 1;
  const acc = Array.from({ length: ring }, () => new Float64Array(n));
  /** 写出一行输出（预乘的累加值还原），清空它的累加值 */
  const flush = (y: number) => {
    const a = acc[y % ring];
    const orow = y * n;
    if (ch === 4) {
      for (let i = 0; i < n; i += 4) {
        const al = a[i + 3];
        if (al > 0) {
          out[orow + i] = Math.min(255, Math.round(a[i] / al));
          out[orow + i + 1] = Math.min(255, Math.round(a[i + 1] / al));
          out[orow + i + 2] = Math.min(255, Math.round(a[i + 2] / al));
        }
        out[orow + i + 3] = Math.min(255, Math.round(al));
      }
    } else for (let i = 0; i < n; i++) out[orow + i] = Math.min(255, Math.round(a[i]));
    a.fill(0);
  };
  const { start: xStart, count: xCount, weights: xw, stride: xStride } = xs;
  let done = 0;
  for (let sy = 0; sy < sh; sy++) {
    // 横向：这一行缩到 tw 列（预乘）
    const so = sy * sw * ch;
    if (ch === 3) {
      for (let x = 0, o = 0; x < tw; x++, o += 3) {
        let r = 0, g = 0, b = 0;
        const wo = x * xStride, cnt = xCount[x];
        for (let k = 0, p = so + xStart[x] * 3; k < cnt; k++, p += 3) {
          const w = xw[wo + k];
          r += src[p] * w; g += src[p + 1] * w; b += src[p + 2] * w;
        }
        row[o] = r; row[o + 1] = g; row[o + 2] = b;
      }
    } else {
      for (let x = 0, o = 0; x < tw; x++, o += 4) {
        let r = 0, g = 0, b = 0, a = 0;
        const wo = x * xStride, cnt = xCount[x];
        for (let k = 0, p = so + xStart[x] * 4; k < cnt; k++, p += 4) {
          const al = src[p + 3] * xw[wo + k];
          r += src[p] * al; g += src[p + 1] * al; b += src[p + 2] * al; a += al;
        }
        row[o] = r; row[o + 1] = g; row[o + 2] = b; row[o + 3] = a;
      }
    }
    // 纵向：按权重加到用到这一行的输出行上
    for (let y = done; y < th && ys.start[y] <= sy; y++) {
      const k = sy - ys.start[y];
      if (k >= ys.count[y]) continue;
      const w = ys.weights[y * ys.stride + k];
      const a = acc[y % ring];
      for (let i = 0; i < n; i++) a[i] += row[i] * w;
    }
    // 用到的源行都加完了的输出行写出去
    while (done < th && ys.start[done] + ys.count[done] - 1 <= sy) flush(done++);
  }
  while (done < th) flush(done++);
  return out;
}
