/**
 * PNG 按整数倍缩小（出图前缩小超大图片用，见 preview/huge-images.ts）：边解压边逐行还原过滤，每 factor×factor 个像素
 * 按预乘透明度取平均（透明像素的颜色不渗到旁边），只存一行原图和一行累加值，不在内存里展开整张原图。
 * 支持 8 位、16 位（取高字节）的灰度、真彩色、带透明通道的，和 8 位调色板（含 tRNS）；隔行、1/2/4 位、灰度/真彩色带 tRNS 的返回 undefined。
 * 原图没有透明度的（灰度、真彩色、调色板没有 tRNS）出 RGB，其它出 RGBA（出图前剔除被不透明图片盖住的元素要靠这个判断）。
 * 颜色空间相关的块（gAMA、iCCP 等）不保留。
 */
import { concat, encodePixels, readChunks, unfilter } from './png';

/** 缩小一张 PNG，返回新的 PNG（8 位）；格式不支持或数据有问题时返回 undefined */
export async function shrinkPng(bytes: Uint8Array, factor: number): Promise<Uint8Array | undefined> {
  const cs = readChunks(bytes);
  const ihdr = cs?.[0];
  if (!cs || ihdr?.type !== 'IHDR' || ihdr.data.length < 13 || factor < 2) return undefined;
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

  const addRow = (row: Uint8Array) => {
    for (let x = 0, i = 0; x < w; x++, i += bpp) {
      let r: number, g: number, b: number, a: number;
      if (palette) {
        const p = row[i] * 4;
        r = palette[p]; g = palette[p + 1]; b = palette[p + 2]; a = palette[p + 3];
      } else if (channels === 1) { r = g = b = row[i]; a = 255; }
      else if (channels === 2) { r = g = b = row[i]; a = row[i + step]; }
      else { r = row[i]; g = row[i + step]; b = row[i + 2 * step]; a = channels === 4 ? row[i + 3 * step] : 255; }
      const o = Math.floor(x / factor) * 4;
      acc[o] += r * a; acc[o + 1] += g * a; acc[o + 2] += b * a; acc[o + 3] += a;
    }
  };
  const emit = (oy: number, rows: number) => {
    for (let ox = 0; ox < ow; ox++) {
      const o = ox * 4, n = rows * (Math.min(w, (ox + 1) * factor) - ox * factor), a = acc[o + 3];
      const t = (oy * ow + ox) * 4;
      if (a > 0) {
        out[t] = Math.round(acc[o] / a); out[t + 1] = Math.round(acc[o + 1] / a); out[t + 2] = Math.round(acc[o + 2] / a);
        out[t + 3] = Math.round(a / n);
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
      addRow(cur);
      y++;
      if (y % factor === 0 || y === h) emit(Math.ceil(y / factor) - 1, y % factor || factor);
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
  if (channels === 2 || channels === 4 || trns) return encodePixels(out, ow, oh, 4);
  const rgb = new Uint8Array(ow * oh * 3);
  for (let i = 0, j = 0; j < rgb.length; i += 4, j += 3) { rgb[j] = out[i]; rgb[j + 1] = out[i + 1]; rgb[j + 2] = out[i + 2]; }
  return encodePixels(rgb, ow, oh, 3);
}
