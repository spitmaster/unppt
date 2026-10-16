/**
 * esbuild 插件：libjpeg-turbo 的 Emscripten 胶水代码（@cornerstonejs/codec-libjpeg-turbo-8bit 的 libjpegturbowasm.js）
 * 在 Node 下会 require("fs") / require("path")、用 __dirname 去读 wasm 文件，打成 ESM 后既解析不了也跑不了。
 * 我们总是自己把 wasm 字节交给它（wasmBinary），用不到那段：打包时把"是否 Node"固定为否，并去掉那两处 require 和 __dirname。
 * 构建（scripts/build.mjs）和单元测试共用。
 */
import { readFile } from 'node:fs/promises';

export const libjpegTurbo = {
  name: 'libjpeg-turbo-no-node',
  setup(build) {
    build.onLoad({ filter: /libjpegturbowasm\.js$/ }, async (args) => {
      const src = await readFile(args.path, 'utf8');
      const out = src
        .replace(/ENVIRONMENT_IS_NODE=typeof process=="object"[^;,]*/, 'ENVIRONMENT_IS_NODE=false')
        .replace('require("fs")', 'undefined')
        .replace('require("path")', 'undefined')
        .replace(/__dirname/g, '""');
      // 包升级后写法变了就立刻报错，不要悄悄打出跑不了的包
      if (/ENVIRONMENT_IS_NODE=typeof|require\(/.test(out)) throw new Error('libjpeg-turbo 胶水代码的写法变了，scripts/esbuild-libjpeg.mjs 要跟着改');
      return { contents: out, loader: 'js' };
    });
  },
};
