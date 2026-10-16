/**
 * JPEG 编码（整页图、缩略图）：libjpeg-turbo 的 WebAssembly 版（@cornerstonejs/codec-libjpeg-turbo-8bit；libjpeg-turbo 是 IJG/BSD/zlib 许可，
 * 封装是 ISC）。用户 2026-10-16 选定，替换以前自研的编码器：画质、文件大小和以前一样，快 5~15 倍。
 * 基线（非渐进式）、4:4:4（不做色度抽样：页面上彩色文字多，抽样后颜色误差大 7~9 dB）。
 * WASM 在构建时直接打进 JS（esbuild 的 binary loader），不需要调用方另外提供；整个进程只初始化一次。
 *
 * 封装把输出缓冲区按 宽 × 高 × 3 字节分配，编出来的文件比它大时会写越界（实测：8×8、216×1 的图直接崩溃）。所以编码前先估
 * 最坏情况：文件头约 620~680 字节；最难压缩的纯随机噪声质量 85 时约 1.19 字节/像素、质量 95 时约 1.93（实测 256×256）；
 * 按 8×8 块补齐后的像素数算，再留 1.25 倍余量。放不下的图不编（返回 undefined，调用方记警告）：整页图最小 72×72 不会碰到，
 * 只有宽高比超过约 43:1 的页面的缩略图（高 4~5 像素）才可能。
 */
import factory from '@cornerstonejs/codec-libjpeg-turbo-8bit/wasmjs';
import wasm from '@cornerstonejs/codec-libjpeg-turbo-8bit/wasm';

/** 把 RGBA 像素（透明通道不用）编成 JPEG；缓冲区可能放不下时返回 undefined */
export type JpegEncode = (rgba: Uint8Array, width: number, height: number, quality: number) => Uint8Array | undefined;

const TJSAMP_444 = 0;
const HEADER = 1024;

/** 最坏情况下的文件大小（字节）；质量太高没法保证时返回 Infinity */
export function worstJpegSize(width: number, height: number, quality: number): number {
  const perPixel = quality <= 85 ? 1.19 : quality <= 95 ? 1.93 : Infinity;
  const pad = (v: number) => Math.ceil(v / 8) * 8;
  return HEADER + pad(width) * pad(height) * perPixel * 1.25;
}

let ready: Promise<JpegEncode> | undefined;

export function jpegEncoder(): Promise<JpegEncode> {
  ready ??= factory({ wasmBinary: wasm }).then((m) => (rgba, width, height, quality) => {
    if (worstJpegSize(width, height, quality) > width * height * 3) return undefined;
    const e = new m.JPEGEncoder();
    try {
      const rgb = e.getDecodedBuffer({ width, height, bitsPerSample: 8, componentCount: 3, isSigned: false });
      for (let i = 0, j = 0; j < rgb.length; i += 4, j += 3) {
        rgb[j] = rgba[i]; rgb[j + 1] = rgba[i + 1]; rgb[j + 2] = rgba[i + 2];
      }
      e.setQuality(quality);
      e.setSubSampling(TJSAMP_444);
      e.setProgressive(false);
      e.encode();
      // 返回的是 WASM 内存上的 Uint8ClampedArray 视图：复制成普通的 Uint8Array
      const out = e.getEncodedBuffer();
      return new Uint8Array(out.buffer.slice(out.byteOffset, out.byteOffset + out.length));
    } catch (err) {
      // 实测：WASM 里出过一次越界错误后，这个实例的内存就坏了，之后的调用都会出错——丢掉它，下次重新初始化
      ready = undefined;
      throw err;
    } finally {
      try { e.delete(); } catch { /* 实例已经坏了 */ }
    }
  });
  return ready;
}
