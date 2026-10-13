/**
 * 按位置读取数据的来源。大文件（1GB 级）不必整个读进内存，调用方实现 read 即可：
 * Node 里用文件句柄按偏移读，浏览器里用 Blob.slice。
 */
export interface RandomAccessSource {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export type InputSource = Uint8Array | ArrayBuffer | RandomAccessSource;

export function toSource(input: InputSource): RandomAccessSource {
  if (input instanceof Uint8Array || input instanceof ArrayBuffer) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    return {
      size: bytes.length,
      read: async (offset, length) => bytes.subarray(offset, Math.min(offset + length, bytes.length)),
    };
  }
  return input;
}
