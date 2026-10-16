// 出图调度：多页同时画、谁先画完都行，写出和警告仍按页码顺序；背景层的警告只记一次（源码用 esbuild 现场打包后测试）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { libjpegTurbo } from '../../../scripts/esbuild-libjpeg.mjs';

const r = await build({ entryPoints: ['packages/transcoder/src/preview/slide-images.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], loader: { '.wasm': 'binary' }, plugins: [libjpegTurbo], logLevel: 'silent' });
const { SlideImages } = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));

const page = (n) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><rect width="100" height="100" fill="url(#p)"/><defs><pattern id="p"><image href="bg.png"/></pattern></defs><g data-uid="s${n}"><rect width="${n}" height="1"/></g></svg>`;

test('倒序画完：写出、警告都按页码顺序；背景层的警告只记一次', async () => {
  const delays = { 1: 40, 2: 30, 3: 20, 4: 10 };
  const pool = {
    size: 4,
    paint: (job) => new Promise((resolve) => setTimeout(() => resolve({
      pic: new Uint8Array([job.page]), thum: new Uint8Array([job.page]), warnings: [`w${job.page}`],
      ...(job.template ? { layerWarnings: ['背景层'] } : {}),
    }), delays[job.page])),
  };
  const writes = [], warns = [];
  const si = new SlideImages({ picWidth: 100, picHeight: 100, thumbWidth: 50, thumbHeight: 50 }, pool, () => undefined, async () => undefined,
    async (path) => { writes.push(path); }, (m) => warns.push(m));
  for (let n = 1; n <= 4; n++) await si.add(n, page(n));
  await si.flush();
  assert.deepEqual(writes, ['pic/1.jpg', 'thum/1.jpg', 'pic/2.jpg', 'thum/2.jpg', 'pic/3.jpg', 'thum/3.jpg', 'pic/4.jpg', 'thum/4.jpg']);
  // 第 1 页背景第一次出现不拆；第 2 页起用背景层，背景层的警告只记一次
  assert.deepEqual(warns, ['w1', '背景层', 'w2', 'w3', 'w4']);
});
