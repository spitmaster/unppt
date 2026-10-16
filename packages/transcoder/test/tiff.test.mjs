// TIFF 转换：大的不透明照片存 JPEG，截图类（大片纯色）、带透明的、小图存 PNG（源码用 esbuild 现场打包后测试；TIFF 用 utif2 现场生成）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { libjpegTurbo } from '../../../scripts/esbuild-libjpeg.mjs';

const r = await build({ entryPoints: ['packages/transcoder/src/media/tiff.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], loader: { '.wasm': 'binary' }, plugins: [libjpegTurbo], define: { 'window.UDOC': 'undefined' }, logLevel: 'silent' });
const { tiffDecoder } = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
const UTIF = createRequire(import.meta.url)('utif2');

/** w×h 的 TIFF；pixel(x, y) 给出 [r, g, b, a] */
function tiff(w, h, pixel) {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set(pixel(x, y), (y * w + x) * 4);
  return new Uint8Array(UTIF.encodeImage(px, w, h));
}

// 照片：平滑渐变加噪声（相邻像素几乎都不同、颜色很多）
let seed = 1;
const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 9) - 4;
const photo = (x, y) => [100 + ((x >> 4) % 100) + noise(), 80 + ((y >> 4) % 120) + noise(), 120 + noise(), 255];
// 截图：大片纯色、几种颜色的文字块
const shot = (x, y) => ((x >> 3) % 7 === 0 && (y >> 4) % 3 === 0 ? [30, 30, 30, 255] : [250, 250, 250, 255]);

test('2MP 以上的不透明照片存 JPEG', async () => {
  const img = await tiffDecoder.decode(tiff(1800, 1200, photo));
  assert.equal(img.mime, 'image/jpeg');
  assert.ok(img.data[0] === 0xff && img.data[1] === 0xd8);
});

test('截图、带透明的照片、不到 2MP 的照片存 PNG', async () => {
  for (const [name, w, h, p] of [
    ['截图', 1800, 1200, shot],
    ['带透明', 1800, 1200, (x, y) => [...photo(x, y).slice(0, 3), x < 10 ? 0 : 255]],
    ['小照片', 1000, 1000, photo],
  ]) {
    const img = await tiffDecoder.decode(tiff(w, h, p));
    assert.equal(img.mime, 'image/png', name);
  }
});

/** 无压缩的 CMYK TIFF（utif2 只会写 RGBA，手工拼） */
function cmykTiff(w, h, cmyk) {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(cmyk, i * 4);
  const tags = [[256, 3, 1, w], [257, 3, 1, h], [258, 3, 4, 0], [259, 3, 1, 1], [262, 3, 1, 5], [273, 4, 1, 0], [277, 3, 1, 4], [278, 3, 1, h], [279, 4, 1, data.length]];
  const ifd = 8, bpsAt = ifd + 2 + tags.length * 12 + 4, dataAt = bpsAt + 8;
  const b = new Uint8Array(dataAt + data.length), v = new DataView(b.buffer);
  b.set([0x49, 0x49, 42, 0]); v.setUint32(4, ifd, true); v.setUint16(ifd, tags.length, true);
  tags.forEach(([tag, type, count, value], k) => {
    const o = ifd + 2 + k * 12;
    v.setUint16(o, tag, true); v.setUint16(o + 2, type, true); v.setUint32(o + 4, count, true);
    const val = tag === 258 ? bpsAt : tag === 273 ? dataAt : value;
    if (type === 3 && count === 1) v.setUint16(o + 8, val, true); else v.setUint32(o + 8, val, true);
  });
  for (let k = 0; k < 4; k++) v.setUint16(bpsAt + k * 2, 8, true);
  b.set(data, dataAt);
  return b;
}

test('CMYK 的 TIFF 能转（以前 Node 里会因为读 window 抛错，图片丢掉）', async () => {
  // 青 100%：红 0、绿蓝 255
  const img = await tiffDecoder.decode(cmykTiff(4, 4, [255, 0, 0, 0]));
  assert.equal(img?.mime, 'image/png');
});
