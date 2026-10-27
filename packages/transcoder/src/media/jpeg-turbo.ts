/**
 * JPEG 解码（出图时按画的大小缩小图片用，preview/fit-images.ts）：libjpeg-turbo 的 WebAssembly 版——和 jpeg-encode.ts 同一个包、
 * 同一个 .wasm（不增加产物大小），另开一个实例：解码出错时只丢掉这个实例，不连累编码。
 * 比自研的 jpeg.ts 快 6~8 倍（实测 1920×1080 的照片 30~80ms 对 170~670ms，比 resvg 自己解还快约一倍），解出来的像素和 jpeg.ts
 * 基本一样（反变换的舍入不同，个别像素差 1~3 级；4:2:0 的色度插值略有不同，最多差 7 级）。
 * 只解灰度和三分量的：四分量（CMYK / YCCK）它不按 PowerPoint 的规则换算（直接报错），坏了、截断的文件它也报错——都返回 undefined，
 * 由调用方改用 jpeg.ts。解码用的内存在 WASM 里只涨不降，超过 MAX_PIXELS 的不解（出图前超大的图已经先缩小了，见 preview/huge-images.ts）。
 */
import factory, { type TurboModule } from '@cornerstonejs/codec-libjpeg-turbo-8bit/wasmjs';
import wasm from '@cornerstonejs/codec-libjpeg-turbo-8bit/wasm';
import { imageInfo } from './image-info';
import type { RgbImage } from './jpeg';

/** 超过这个像素数的不解（解码要 3 倍的 WASM 内存，而且不会还回来） */
const MAX_PIXELS = 25_000_000;

let ready: Promise<TurboModule> | undefined;

/** 解成 RGB；不是灰度 / 三分量、太大、解不了时 undefined */
export async function decodeJpegTurbo(b: Uint8Array): Promise<RgbImage | undefined> {
  const info = imageInfo(b);
  if (!info || (info.components !== 1 && info.components !== 3) || info.width * info.height > MAX_PIXELS) return undefined;
  let m: TurboModule;
  try {
    m = await (ready ??= factory({ wasmBinary: wasm }));
  } catch {
    ready = undefined;
    return undefined;
  }
  const d = new m.JPEGDecoder();
  try {
    d.getEncodedBuffer(b.length).set(b);
    d.decode();
    const { width, height, componentCount: n, bitsPerSample } = d.getFrameInfo();
    const px = d.getDecodedBuffer();
    if (bitsPerSample !== 8 || (n !== 1 && n !== 3) || px.length < width * height * n) return undefined;
    if (n === 3) return { width, height, data: px.slice(0, width * height * 3) };
    const data = new Uint8Array(width * height * 3);
    for (let i = 0, j = 0; i < width * height; i++, j += 3) data[j] = data[j + 1] = data[j + 2] = px[i];
    return { width, height, data };
  } catch {
    // 坏文件、四分量：libjpeg-turbo 报错（C++ 异常）。实例照常能用（实测），保险起见下次换新实例
    ready = undefined;
    return undefined;
  } finally {
    try { d.delete(); } catch { /* 实例已经坏了 */ }
  }
}
