/** libjpeg-turbo 的 WebAssembly 版（@cornerstonejs/codec-libjpeg-turbo-8bit，Emscripten 编出来的）：编码（media/jpeg-encode.ts）和解码（media/jpeg-turbo.ts） */
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
  interface JPEGDecoder {
    /** 放 JPEG 文件的缓冲区（WASM 内存里，按给的字节数分配） */
    getEncodedBuffer(length: number): Uint8Array;
    /** 出错（四分量、数据坏了）时抛出的是 C++ 异常的指针（一个数字） */
    decode(): void;
    getFrameInfo(): FrameInfo;
    /** 解出来的像素（WASM 内存里的视图，每像素 componentCount 字节，要复制出来） */
    getDecodedBuffer(): Uint8Array;
    delete(): void;
  }
  export interface TurboModule { JPEGEncoder: new () => JPEGEncoder; JPEGDecoder: new () => JPEGDecoder }
  const factory: (options: { wasmBinary: Uint8Array }) => Promise<TurboModule>;
  export default factory;
}

/** 构建时用 esbuild 的 binary loader 打进 JS，导入得到 wasm 文件字节 */
declare module '@cornerstonejs/codec-libjpeg-turbo-8bit/wasm' {
  const bytes: Uint8Array;
  export default bytes;
}
