/**
 * PNG 按整数倍缩小（出图前缩小超大图片、按画的大小缩小图片用，见 preview/huge-images.ts、preview/fit-images.ts）：边解压边逐行还原过滤，每 factor×factor 个像素
 * 按预乘透明度取平均（透明像素的颜色不渗到旁边），只存一行原图和一行累加值，不在内存里展开整张原图。
 * 支持 8 位、16 位（取高字节）的灰度、真彩色、带透明通道的，和 8 位调色板（含 tRNS）；隔行、1/2/4 位、灰度/真彩色带 tRNS 的返回 undefined。
 * 原图没有透明度的（灰度、真彩色、调色板没有 tRNS）出 RGB，其它出 RGBA（出图前剔除被不透明图片盖住的元素要靠这个判断）。
 * 颜色空间相关的块（gAMA、iCCP 等）不保留。
 */
import { concat, encodePixels, readChunks, unfilter } from './png';

/** 缩小一张 PNG，返回新的 PNG（8 位）；格式不支持或数据有问题时返回 undefined */
export async function shrinkPng(bytes: Uint8Array, factor: number): Promise<Uint8Array | undefined> {
  if (factor < 2) return undefined;
  const img = await shrinkPngPixels(bytes, factor);
  if (!img) return undefined;
  const { width: ow, height: oh, data: out } = img;
  if (img.alpha) return encodePixels(out, ow, oh, 4);
  const rgb = new Uint8Array(ow * oh * 3);
  for (let i = 0, j = 0; j < rgb.length; i += 4, j += 3) { rgb[j] = out[i]; rgb[j + 1] = out[i + 1]; rgb[j + 2] = out[i + 2]; }
  return encodePixels(rgb, ow, oh, 3);
}

/** 按整数倍（factor ≥ 1）缩小后的像素：RGBA（不预乘），alpha 表示原图有没有透明度 */
export interface ShrunkPng { width: number; height: number; data: Uint8Array; alpha: boolean }

export async function shrinkPngPixels(bytes: Uint8Array, factor: number): Promise<ShrunkPng | undefined> {
  const cs = readChunks(bytes);
  const ihdr = cs?.[0];
  if (!cs || ihdr?.type !== 'IHDR' || ihdr.data.length < 13 || factor < 1 || !Number.isInteger(factor)) return undefined;
  const d = ihdr.data;
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const w = dv.getUint32(0), h = dv.getUint32(4), depth = d[8], type = d[9], interlace = d[12];
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type];
  if (!w || !h || !channels || interlace !== 0 || (depth !== 8 && depth !== 16) || (type === 3 && depth !== 8)) return undefined;
  const trns = cs.find((c) => c.type === 'tRNS')?.data;
  if (trns && type !== 3) return undefined;
  let palette: Uint8Array | undefined;
  if (type === 3) {
    const plte = cs.find((c) => c.type === 'PLTE')?.data;
    if (!plte) return undefined;
    // 调色板展开成 RGBA，没写透明度的是不透明
    palette = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      palette[i * 4] = plte[i * 3] ?? 0; palette[i * 4 + 1] = plte[i * 3 + 1] ?? 0; palette[i * 4 + 2] = plte[i * 3 + 2] ?? 0;
      palette[i * 4 + 3] = trns && i < trns.length ? trns[i] : 255;
    }
  }
  const idat = cs.filter((c) => c.type === 'IDAT');
  if (!idat.length) return undefined;

  const bpp = channels * (depth / 8), stride = w * bpp, step = depth / 8;
  const ow = Math.ceil(w / factor), oh = Math.ceil(h / factor);
  const out = new Uint8Array(ow * oh * 4);
  // 累加值：预乘后的 r、g、b 和透明度
  const acc = new Float64Array(ow * 4);
  let cur = new Uint8Array(stride), prev = new Uint8Array(stride);
  const line = new Uint8Array(stride + 1);
  let filled = 0, y = 0, bad = false;

  /**
   * 一行加进累加值：每种格式一个循环（逐像素判断格式要慢一倍多）。不透明的不乘透明度：Σ(r·255) / (255·n) 和 Σr / n 是同一个数，
   * 浮点除法的结果也一样
   */
  const opaque = !palette && (channels === 1 || channels === 3);
  const addRow = (row: Uint8Array) => {
    for (let x = 0, i = 0, o = 0, k = 0; x < w; x++, i += bpp) {
      if (palette) {
        const p = row[i] * 4, a = palette[p + 3];
        acc[o] += palette[p] * a; acc[o + 1] += palette[p + 1] * a; acc[o + 2] += palette[p + 2] * a; acc[o + 3] += a;
      } else if (opaque) {
        if (channels === 1) { const v = row[i]; acc[o] += v; acc[o + 1] += v; acc[o + 2] += v; }
        else { acc[o] += row[i]; acc[o + 1] += row[i + step]; acc[o + 2] += row[i + 2 * step]; }
        acc[o + 3] += 1;
      } else {
        const a = row[i + (channels - 1) * step];
        if (channels === 2) { const v = row[i] * a; acc[o] += v; acc[o + 1] += v; acc[o + 2] += v; }
        else { acc[o] += row[i] * a; acc[o + 1] += row[i + step] * a; acc[o + 2] += row[i + 2 * step] * a; }
        acc[o + 3] += a;
      }
      if (++k === factor) { k = 0; o += 4; }
    }
  };
  /** 不缩（factor 1，按画的大小缩小时整数倍用不上的情况）：一行直接展开成 RGBA，结果和按块平均一样（透明度 0 的像素颜色记 0） */
  const direct = (row: Uint8Array, oy: number) => {
    const t0 = oy * w * 4;
    if (palette) {
      for (let x = 0, t = t0; x < w; x++, t += 4) {
        const p = row[x] * 4, a = palette[p + 3];
        if (a) { out[t] = palette[p]; out[t + 1] = palette[p + 1]; out[t + 2] = palette[p + 2]; }
        out[t + 3] = a;
      }
    } else if (channels >= 3) {
      for (let x = 0, i = 0, t = t0; x < w; x++, i += bpp, t += 4) {
        const a = channels === 4 ? row[i + 3 * step] : 255;
        if (a) { out[t] = row[i]; out[t + 1] = row[i + step]; out[t + 2] = row[i + 2 * step]; }
        out[t + 3] = a;
      }
    } else {
      for (let x = 0, i = 0, t = t0; x < w; x++, i += bpp, t += 4) {
        const a = channels === 2 ? row[i + step] : 255;
        if (a) out[t] = out[t + 1] = out[t + 2] = row[i];
        out[t + 3] = a;
      }
    }
  };
  const emit = (oy: number, rows: number) => {
    for (let ox = 0; ox < ow; ox++) {
      const o = ox * 4, n = rows * (Math.min(w, (ox + 1) * factor) - ox * factor), a = acc[o + 3];
      const t = (oy * ow + ox) * 4;
      if (a > 0) {
        out[t] = Math.round(acc[o] / a); out[t + 1] = Math.round(acc[o + 1] / a); out[t + 2] = Math.round(acc[o + 2] / a);
        out[t + 3] = opaque ? 255 : Math.round(a / n);
      }
    }
    acc.fill(0);
  };
  const consume = (chunk: Uint8Array) => {
    for (let p = 0; p < chunk.length && y < h;) {
      const n = Math.min(chunk.length - p, line.length - filled);
      line.set(chunk.subarray(p, p + n), filled);
      filled += n;
      p += n;
      if (filled < line.length) break;
      filled = 0;
      if (!unfilter(line[0], line.subarray(1), cur, y > 0 ? prev : undefined, bpp)) { bad = true; return; }
      if (factor === 1) direct(cur, y++);
      else {
        addRow(cur);
        y++;
        if (y % factor === 0 || y === h) emit(Math.ceil(y / factor) - 1, y % factor || factor);
      }
      [cur, prev] = [prev, cur];
    }
  };

  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  writer.write(concat(idat.map((c) => c.data)) as Uint8Array<ArrayBuffer>).catch(() => {});
  writer.close().catch(() => {});
  try {
    const reader = ds.readable.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      consume(value);
      if (bad || y >= h) { await reader.cancel().catch(() => {}); break; }
    }
  } catch {
    return undefined;
  }
  if (bad || y < h) return undefined;
  return { width: ow, height: oh, data: out, alpha: channels === 2 || channels === 4 || !!trns };
}
