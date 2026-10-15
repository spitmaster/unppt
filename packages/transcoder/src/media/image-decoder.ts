/**
 * 扩展点：浏览器不能直接显示的图片格式（EMF、WMF、TIFF……）在转码时转换成浏览器能显示的格式。
 * 加一种格式：新建一个实现 ImageDecoder 的文件，然后在 decoders.ts 里注册。
 */
export interface DecodedImage {
  mime: string;
  data: Uint8Array;
}

export interface ImageDecoder {
  /** 负责的文件扩展名（小写，不带点） */
  readonly exts: readonly string[];
  /** 无法解析时返回 undefined（不要抛异常）；可以是异步的 */
  decode(bytes: Uint8Array): DecodedImage | undefined | Promise<DecodedImage | undefined>;
}

/** 转成 SVG 的解码器共用 */
export function svgImage(svg: string | undefined): DecodedImage | undefined {
  return svg ? { mime: 'image/svg+xml', data: new TextEncoder().encode(svg) } : undefined;
}
