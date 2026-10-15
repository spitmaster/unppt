// JPEG 编码（缩略图里的照片）：编出来的文件用我们自己的解码器解回来，和原图平均误差要小；再写到 .cache 用 Pillow 校验（见 tools 外的人工检查）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

async function load(entry) {
  const r = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent' });
  return import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
}
const { encodeJpeg } = await load('packages/transcoder/src/media/jpeg-encode.ts');
const { decodeJpeg } = await load('packages/transcoder/src/media/jpeg.ts');

for (const [w, h] of [[37, 21], [8, 8], [1, 1], [64, 40]]) {
  test(`JPEG 编码 ${w}×${h}：解回来和原图接近`, () => {
    const rgb = new Uint8Array(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3;
      rgb[o] = (x * 255) / Math.max(1, w - 1); rgb[o + 1] = (y * 255) / Math.max(1, h - 1); rgb[o + 2] = ((x + y) * 7) & 255;
    }
    const jpg = encodeJpeg(rgb, w, h, 90);
    const img = decodeJpeg(jpg);
    assert.ok(img, '解不出来');
    assert.equal(img.width, w);
    assert.equal(img.height, h);
    let err = 0;
    for (let i = 0; i < rgb.length; i++) err += Math.abs(img.data[i] - rgb[i]);
    assert.ok(err / rgb.length < 6, `平均误差 ${(err / rgb.length).toFixed(2)}`);
  });
}
