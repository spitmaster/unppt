// 出图前缩小超大 JPEG：超过阈值的 JPEG 按 1/8 解码后重新编码，同一张图只缩一次；其它图片原样交给 resvg（源码用 esbuild 现场打包后测试）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { libjpegTurbo } from '../../../scripts/esbuild-libjpeg.mjs';

async function load(entry) {
  const r = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], loader: { '.wasm': 'binary' }, plugins: [libjpegTurbo], logLevel: 'silent' });
  return import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
}
const { withHugeImagesShrunk, shrinkHugeJpeg } = await load('packages/transcoder/src/preview/huge-images.ts');
const { jpegEncoder } = await load('packages/transcoder/src/media/jpeg-encode.ts');
const { decodeJpeg } = await load('packages/transcoder/src/media/jpeg.ts');

const W = 640, H = 384;
const rgba = new Uint8Array(W * H * 4);
for (let i = 0; i < W * H; i++) { rgba[i * 4] = 200; rgba[i * 4 + 1] = (i % W) & 255; rgba[i * 4 + 2] = 40; rgba[i * 4 + 3] = 255; }
const jpg = (await jpegEncoder())(rgba, W, H, 90);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

test('超过阈值的 JPEG 缩成 1/8，颜色基本不变', async () => {
  const small = await shrinkHugeJpeg(jpg, 10000);
  const img = decodeJpeg(small);
  assert.equal(img.width, W / 8);
  assert.equal(img.height, H / 8);
  assert.ok(Math.abs(img.data[0] - 200) < 8 && Math.abs(img.data[2] - 40) < 8);
  assert.equal(await shrinkHugeJpeg(jpg, W * H), undefined, '没超过阈值不缩');
  assert.equal(await shrinkHugeJpeg(png, 1), undefined, '不是 JPEG 不缩');
});

test('包一层图片来源：同一张图只缩一次，其它图片原样返回', async () => {
  let reads = 0;
  const files = { 'media/big.jpg': jpg, 'media/a.png': png };
  const cache = new Map();
  const src = withHugeImagesShrunk(async (h) => { reads++; return files[h]; }, cache, 10000);
  const a = await src('media/big.jpg');
  const b = await src('media/big.jpg');
  assert.equal(a, b);
  assert.equal(decodeJpeg(a).width, W / 8);
  assert.equal(reads, 1, '第二次直接用缓存');
  assert.equal(await src('media/a.png'), png);
  assert.equal(await src('media/missing.jpg'), undefined);
});
