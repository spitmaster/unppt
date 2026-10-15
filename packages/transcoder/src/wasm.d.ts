/** 构建时用 esbuild 的 binary loader 把 .wasm 打进 JS，导入得到文件字节 */
declare module '*.wasm' {
  const bytes: Uint8Array;
  export default bytes;
}
