// 构建：先打包播放器，再把播放器代码内嵌进转码器（转码出来的 HTML 自带播放器）。
import { build } from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

const minify = !process.argv.includes('--dev');

await mkdir('packages/player/dist', { recursive: true });
await build({
  entryPoints: ['packages/player/src/player.ts'],
  outfile: 'packages/player/dist/player.js',
  bundle: true,
  format: 'iife',
  globalName: 'UnpptPlayer',
  target: ['es2019'],
  minify,
  legalComments: 'none',
});
await build({
  entryPoints: ['packages/player/src/host.ts'],
  outfile: 'packages/player/dist/host.js',
  bundle: true,
  format: 'esm',
  target: ['es2019'],
  minify: false,
});
const player = (await readFile('packages/player/dist/player.js', 'utf8')).replace(/<\/script/gi, '<\\/script').trim();

const define = { __UNPPT_PLAYER__: JSON.stringify(player) };
await build({
  entryPoints: ['packages/transcoder/src/index.ts'],
  outfile: 'packages/transcoder/dist/index.js',
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  // 第三方类库（saxes 等）只写了 main 字段，通用平台默认不读，要显式指定
  mainFields: ['module', 'main'],
  target: ['es2020'],
  define,
});
await build({
  entryPoints: ['packages/transcoder/src/cli.ts'],
  outfile: 'packages/transcoder/dist/cli.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node20'],
  define,
});
// 缩略图光栅化用的 resvg（WASM，MPL-2.0）：JS 部分已经打进转码器，.wasm 文件放在旁边一起发布
await copyFile('node_modules/@resvg/resvg-wasm/index_bg.wasm', 'packages/transcoder/dist/resvg.wasm');
console.log(`构建完成（播放器 ${(player.length / 1024).toFixed(1)} KB）`);
