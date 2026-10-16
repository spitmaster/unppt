/** libjpeg-turbo 的 WebAssembly 版（@cornerstonejs/codec-libjpeg-turbo-8bit，Emscripten 编出来的）：只用编码部分 */
declare module '@cornerstonejs/codec-libjpeg-turbo-8bit/wasmjs' {
  interface FrameInfo { width: number; height: number; bitsPerSample: number; componentCount: number; isSigned: boolean }
  interface JPEGEncoder {
    /** 待编码像素的缓冲区（WASM 内存里，按 FrameInfo 分配） */
    getDecodedBuffer(info: FrameInfo): Uint8Array;
    setQuality(quality: number): void;
    /** 色度抽样：0 = 4:4:4、2 = 4:2:0（libjpeg-turbo 的 TJSAMP_*） */
    setSubSampling(subsampling: number): void;
    setProgressive(progressive: boolean): void;
    encode(): void;
    /** 编好的 JPEG（WASM 内存里的视图，要复制出来） */
    getEncodedBuffer(): Uint8ClampedArray;
    delete(): void;
  }
  interface TurboModule { JPEGEncoder: new () => JPEGEncoder }
  const factory: (options: { wasmBinary: Uint8Array }) => Promise<TurboModule>;
  export default factory;
}

/** 构建时用 esbuild 的 binary loader 打进 JS，导入得到 wasm 文件字节 */
declare module '@cornerstonejs/codec-libjpeg-turbo-8bit/wasm' {
  const bytes: Uint8Array;
  export default bytes;
}
