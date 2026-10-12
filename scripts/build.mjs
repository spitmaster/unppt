// 构建：先打包播放器，再把播放器代码内嵌进转码器（转码出来的 HTML 自带播放器）。
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

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
await writeFile('packages/transcoder/dist/package.json', '{"type":"module"}\n');
await writeFile('packages/player/dist/package.json', '{"type":"module"}\n');
console.log(`构建完成（播放器 ${(player.length / 1024).toFixed(1)} KB）`);
