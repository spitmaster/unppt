// PNG 按整数倍缩小：边解压边缩、按预乘透明度取平均、没有透明度的出 RGB；超大 PNG 出图前缩小（源码用 esbuild 现场打包后测试）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { libjpegTurbo } from '../../../scripts/esbuild-libjpeg.mjs';

async function load(entry) {
  const r = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], loader: { '.wasm': 'binary' }, plugins: [libjpegTurbo], logLevel: 'silent' });
  return import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
}
const { shrinkPng } = await load('packages/transcoder/src/media/png-shrink.ts');
const { encodePixels, readChunks, unfilter } = await load('packages/transcoder/src/media/png.ts');
const { shrinkHugeImage } = await load('packages/transcoder/src/preview/huge-images.ts');

/** 测试用的 PNG 解码（8 位、不隔行）：返回 { w, h, type, px } */
async function decode(b) {
  const cs = readChunks(b);
  const dv = new DataView(cs[0].data.buffer, cs[0].data.byteOffset);
  const w = dv.getUint32(0), h = dv.getUint32(4), type = cs[0].data[9], bpp = type === 6 ? 4 : 3;
  const z = Buffer.concat(cs.filter((c) => c.type === 'IDAT').map((c) => c.data));
  const raw = new Uint8Array(await new Response(new Blob([z]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
  const px = new Uint8Array(w * h * bpp);
  for (let y = 0; y < h; y++) {
    const s = y * (w * bpp + 1);
    unfilter(raw[s], raw.subarray(s + 1, s + 1 + w * bpp), px.subarray(y * w * bpp, (y + 1) * w * bpp), y ? px.subarray((y - 1) * w * bpp, y * w * bpp) : undefined, bpp);
  }
  return { w, h, type, px };
}

test('RGBA：每 3×3 按预乘透明度取平均，透明像素的颜色不渗进来；边上不满一格的按实际像素数', async () => {
  const W = 7, H = 4, px = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    // 左半红色不透明，右半全透明（颜色是绿色，不应出现）
    const x = i % W;
    px.set(x < 3 ? [255, 0, 0, 255] : [0, 255, 0, 0], i * 4);
  }
  px.set([0, 0, 255, 255], (1 * W + 4) * 4);
  const out = await decode(await shrinkPng(await encodePixels(px, W, H, 4), 3));
  assert.deepEqual([out.w, out.h, out.type], [3, 2, 6]);
  assert.deepEqual([...out.px.subarray(0, 4)], [255, 0, 0, 255]);
  // 第二格只有一个蓝色不透明像素：颜色是蓝色，透明度 1/9
  assert.deepEqual([...out.px.subarray(4, 8)], [0, 0, 255, Math.round(255 / 9)]);
  // 第三格（第 7 列，只有 1 列）全透明
  assert.equal(out.px[11], 0);
  // 第二行格子只有原图第 4 行（1 行 × 3 列）
  assert.deepEqual([...out.px.subarray(12, 16)], [255, 0, 0, 255]);
});

test('不透明的 RGB 出 RGB（出图剔除遮挡要靠它判断不透明）', async () => {
  const W = 8, H = 8, px = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H; i++) px.set([(i % W) * 30, 100, 200], i * 3);
  const out = await decode(await shrinkPng(await encodePixels(px, W, H, 3), 4));
  assert.deepEqual([out.w, out.h, out.type], [2, 2, 2]);
  assert.deepEqual([...out.px.subarray(0, 3)], [45, 100, 200]);
  assert.deepEqual([...out.px.subarray(3, 6)], [165, 100, 200]);
});

test('长边是整页图长边 4 倍以上的 PNG 出图前缩小，不到的原样', async () => {
  const W = 40, H = 20, px = new Uint8Array(W * H * 3).fill(128);
  const png = await encodePixels(px, W, H, 3);
  const small = await decode(await shrinkHugeImage(png, 50_000_000, 10));
  assert.deepEqual([small.w, small.h], [10, 5]);
  assert.equal(await shrinkHugeImage(png, 50_000_000, 11), undefined);
});
