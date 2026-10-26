// 四分量（CMYK / YCCK）JPEG 在产物里换成 sRGB（浏览器换算颜色和 PowerPoint 不一样）；源码用 esbuild 现场打包后测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { build } from 'esbuild';
import { libjpegTurbo } from '../../../scripts/esbuild-libjpeg.mjs';

async function load(entry) {
  const r = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], loader: { '.wasm': 'binary' }, plugins: [libjpegTurbo], logLevel: 'silent' });
  return import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
}
const { cmykJpegToSrgb } = await load('packages/transcoder/src/media/cmyk-jpeg.ts');
const { jpegEncoder } = await load('packages/transcoder/src/media/jpeg-encode.ts');
const DIR = new URL('./images/', import.meta.url);

/** 8 位 RGB PNG 解成像素 */
function decodePng(png) {
  let o = 8, w = 0;
  const idat = [];
  while (o < png.length) {
    const len = Buffer.from(png.buffer, png.byteOffset + o, 4).readUInt32BE();
    const type = String.fromCharCode(...png.subarray(o + 4, o + 8));
    if (type === 'IHDR') { w = Buffer.from(png.buffer, png.byteOffset + o + 8, 4).readUInt32BE(); assert.equal(png[o + 17], 2); }
    if (type === 'IDAT') idat.push(png.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = w * 3, h = raw.length / (stride + 1), px = new Uint8Array(stride * h);
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const a = i >= 3 ? px[y * stride + i - 3] : 0, b = y ? px[(y - 1) * stride + i] : 0, c = y && i >= 3 ? px[(y - 1) * stride + i - 3] : 0;
      px[y * stride + i] = (raw[y * (stride + 1) + 1 + i] + [0, a, b, (a + b) >> 1, paeth(a, b, c)][f]) & 0xff;
    }
  }
  return { width: w, height: h, data: px };
}

test('CMYK、YCCK（有没有嵌入配置文件）都换成 sRGB，颜色和按配置文件换算的一致', async () => {
  for (const name of ['cmyk', 'ycck', 'ycck-icc']) {
    const out = await cmykJpegToSrgb(new Uint8Array(await readFile(new URL(`${name}.jpg`, DIR))));
    assert.ok(out, name);
    // 这么小的图 JPEG 编码器放不下，存 PNG
    assert.equal(out.mime, 'image/png');
    const img = decodePng(out.data), ref = new Uint8Array(await readFile(new URL(`${name}.rgb`, DIR)));
    assert.equal(img.width, 52);
    let sum = 0;
    for (let i = 0; i < ref.length; i++) sum += Math.abs(img.data[i] - ref[i]);
    assert.ok(sum / ref.length < 1.5, `${name}：平均误差 ${(sum / ref.length).toFixed(2)}`);
  }
});

test('普通的 RGB JPEG 不处理', async () => {
  const rgba = new Uint8Array(64 * 64 * 4).fill(200);
  const jpg = (await jpegEncoder())(rgba, 64, 64, 90);
  assert.equal(await cmykJpegToSrgb(jpg), undefined);
  assert.equal(await cmykJpegToSrgb(new Uint8Array(await readFile(new URL('baseline-444.jpg', DIR)))), undefined);
});
