// 出图前缩小超大 JPEG：超过阈值的 JPEG 按 1/8 解码后重新编码，同一张图只缩一次；其它图片原样交给 resvg（源码用 esbuild 现场打包后测试）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { libjpegTurbo } from '../../../scripts/esbuild-libjpeg.mjs';

async function load(entry) {
  const r = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], loader: { '.wasm': 'binary' }, plugins: [libjpegTurbo], logLevel: 'silent' });
  return import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
}
const { withHugeImagesShrunk, shrinkHugeImage } = await load('packages/transcoder/src/preview/huge-images.ts');
const { jpegEncoder } = await load('packages/transcoder/src/media/jpeg-encode.ts');
const { decodeJpeg } = await load('packages/transcoder/src/media/jpeg.ts');

const W = 640, H = 384;
const rgba = new Uint8Array(W * H * 4);
for (let i = 0; i < W * H; i++) { rgba[i * 4] = 200; rgba[i * 4 + 1] = (i % W) & 255; rgba[i * 4 + 2] = 40; rgba[i * 4 + 3] = 255; }
const jpg = (await jpegEncoder())(rgba, W, H, 90);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

test('超过阈值的 JPEG 缩成 1/8，颜色基本不变', async () => {
  const small = await shrinkHugeImage(jpg, 10000);
  const img = decodeJpeg(small);
  assert.equal(img.width, W / 8);
  assert.equal(img.height, H / 8);
  assert.ok(Math.abs(img.data[0] - 200) < 8 && Math.abs(img.data[2] - 40) < 8);
  assert.equal(await shrinkHugeImage(jpg, W * H), undefined, '没超过阈值不缩');
  assert.equal(await shrinkHugeImage(png, 1), undefined, '不是 JPEG 不缩');
});

test('没到像素阈值、但长边是整页图长边 4 倍以上的 JPEG：缩到长边仍不小于整页图的最小比例', async () => {
  assert.equal(decodeJpeg(await shrinkHugeImage(jpg, W * H, W / 8)).width, W / 8, '1/8 正好等于整页图');
  assert.equal(decodeJpeg(await shrinkHugeImage(jpg, W * H, W / 8 + 1)).width, W / 4);
  assert.equal(await shrinkHugeImage(jpg, W * H, W / 4 + 1), undefined, '长边不到整页图 4 倍的不缩');
});

test('按 1/2、1/4 解码等于全尺寸解出来再按格子取平均', () => {
  const full = decodeJpeg(jpg);
  for (const k of [2, 4]) {
    const img = decodeJpeg(jpg, W / k);
    assert.equal(img.width, W / k);
    let max = 0;
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) s += full.data[((y * k + dy) * W + x * k + dx) * 3 + c];
      max = Math.max(max, Math.abs(img.data[(y * img.width + x) * 3 + c] - s / (k * k)));
    }
    assert.ok(max <= 3, `1/${k}：最大差 ${max}`);
  }
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

test('同时要同一张超大图（多个出图线程）：只读、只缩一次，拿到的是同一份', async () => {
  let reads = 0;
  const src = withHugeImagesShrunk(async () => { reads++; await new Promise((r) => setTimeout(r, 10)); return jpg; }, new Map(), 10000);
  const all = await Promise.all([src('media/big.jpg'), src('media/big.jpg'), src('media/big.jpg')]);
  assert.equal(reads, 1);
  assert.ok(all.every((x) => x === all[0]));
});
