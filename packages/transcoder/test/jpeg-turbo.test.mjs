// libjpeg-turbo（WASM）解码：灰度展开成 RGB、和自研解码器一致；四分量、坏文件返回 undefined，之后照常能解（源码用 esbuild 现场打包后测试）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { libjpegTurbo } from '../../../scripts/esbuild-libjpeg.mjs';

async function load(entry) {
  const r = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], loader: { '.wasm': 'binary' }, plugins: [libjpegTurbo], logLevel: 'silent' });
  return import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
}
const { decodeJpegTurbo } = await load('packages/transcoder/src/media/jpeg-turbo.ts');
const { decodeJpeg } = await load('packages/transcoder/src/media/jpeg.ts');
const { jpegEncoder } = await load('packages/transcoder/src/media/jpeg-encode.ts');

test('三分量：和自研解码器的像素基本一样', async () => {
  const w = 120, h = 80, rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) rgba.set([(i * 7) & 255, (i % w) * 2, 255 - (i % w), 255], i * 4);
  const jpg = (await jpegEncoder())(rgba, w, h, 90);
  const a = await decodeJpegTurbo(jpg), b = decodeJpeg(jpg);
  assert.equal(a.width, w);
  assert.equal(a.height, h);
  assert.equal(a.data.length, w * h * 3);
  let diff = 0, sum = 0;
  for (let i = 0; i < a.data.length; i++) { const d = Math.abs(a.data[i] - b.data[i]); diff = Math.max(diff, d); sum += d; }
  // 反变换的舍入不同：个别像素差几级
  assert.ok(diff <= 3 && sum / a.data.length < 0.5, `最大差 ${diff}，平均差 ${sum / a.data.length}`);
});

test('灰度展开成 RGB；四分量（CMYK）、截断的文件返回 undefined，之后照常能解', async () => {
  const photo = await readFile('packages/transcoder/test/images/baseline-444.jpg');
  for (const f of ['cmyk.jpg', 'ycck.jpg']) assert.equal(await decodeJpegTurbo(await readFile(`packages/transcoder/test/images/${f}`)), undefined, f);
  assert.equal(await decodeJpegTurbo(photo.subarray(0, photo.length >> 1)), undefined);
  const ok = await decodeJpegTurbo(photo);
  assert.ok(ok && ok.data.length === ok.width * ok.height * 3);
  const gray = await readFile('packages/transcoder/test/images/gray.jpg');
  const g = await decodeJpegTurbo(gray), j = decodeJpeg(gray);
  assert.equal(g.data.length, g.width * g.height * 3);
  for (let i = 0; i < g.data.length; i += 3) assert.ok(g.data[i] === g.data[i + 1] && g.data[i] === g.data[i + 2] && Math.abs(g.data[i] - j.data[i]) <= 1);
});
