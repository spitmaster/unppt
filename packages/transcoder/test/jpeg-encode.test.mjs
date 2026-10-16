// JPEG 编码（整页图、缩略图，libjpeg-turbo WASM）：编出来的文件用我们自己的解码器解回来，尺寸对、和原图平均误差要小（源码用 esbuild 现场打包后测试）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { libjpegTurbo } from '../../../scripts/esbuild-libjpeg.mjs';

async function load(entry) {
  const r = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], loader: { '.wasm': 'binary' }, plugins: [libjpegTurbo], logLevel: 'silent' });
  return import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
}
const { jpegEncoder, worstJpegSize } = await load('packages/transcoder/src/media/jpeg-encode.ts');
const { decodeJpeg } = await load('packages/transcoder/src/media/jpeg.ts');
const encode = await jpegEncoder();

/** 渐变图（noise 时加噪声，编出来的数据量大） */
function image(w, h, noise) {
  const rgba = new Uint8Array(w * h * 4);
  let seed = 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    const n = noise ? ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 64) - 32 : 0;
    rgba[o] = Math.max(0, Math.min(255, (x * 255) / Math.max(1, w - 1) + n));
    rgba[o + 1] = Math.max(0, Math.min(255, (y * 255) / Math.max(1, h - 1) - n));
    rgba[o + 2] = ((x + y) * 7) & 255;
    rgba[o + 3] = 255;
  }
  return rgba;
}

for (const [w, h, noise, limit] of [[48, 32, false, 6], [64, 40, false, 6], [72, 72, true, 12], [216, 122, false, 6], [216, 6, true, 12], [1001, 563, true, 12]]) {
  test(`JPEG 编码 ${w}×${h}${noise ? '（噪声）' : ''}：解回来和原图接近`, () => {
    const rgba = image(w, h, noise);
    const jpg = encode(rgba, w, h, 85);
    assert.ok(jpg, '不该放不下');
    assert.equal(jpg[0], 0xff);
    assert.equal(jpg[1], 0xd8);
    const img = decodeJpeg(jpg);
    assert.ok(img, '解不出来');
    assert.equal(img.width, w);
    assert.equal(img.height, h);
    let err = 0;
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) for (let c = 0; c < 3; c++) err += Math.abs(img.data[j + c] - rgba[i + c]);
    const avg = err / (w * h * 3);
    assert.ok(avg < limit, `平均误差 ${avg.toFixed(2)}`);
  });
}

test('JPEG 编码：同一个编码器连续编多张、结果稳定', () => {
  const a = image(120, 80, true);
  const first = encode(a, 120, 80, 85);
  for (let k = 0; k < 20; k++) encode(image(97 + k, 33 + k, k % 2 === 0), 97 + k, 33 + k, 85);
  assert.deepEqual(encode(a, 120, 80, 85), first);
});

test('JPEG 编码：缓冲区可能放不下的小图不编（封装按 宽×高×3 分配输出缓冲区，放不下会写越界）', () => {
  for (const [w, h] of [[1, 1], [8, 8], [16, 8], [216, 1], [216, 4], [216, 5]]) {
    assert.equal(encode(image(w, h, true), w, h, 85), undefined, `${w}×${h}`);
  }
  // 整页图最小 72×72、缩略图宽 216 高 6 以上，最坏情况也放得下
  assert.ok(worstJpegSize(72, 72, 85) <= 72 * 72 * 3);
  assert.ok(worstJpegSize(216, 6, 85) <= 216 * 6 * 3);
  assert.equal(worstJpegSize(64, 64, 100), Infinity);
});
