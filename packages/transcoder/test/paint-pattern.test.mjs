// 出图时 <pattern> 里的图片（图片填充、背景图）内联成 data URI：照样画上；同一张图在一次转换里只要一次（每页都用的背景图不必每页重新编码）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { libjpegTurbo } from '../../../scripts/esbuild-libjpeg.mjs';

async function load(entry) {
  const r = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], loader: { '.wasm': 'binary' }, plugins: [libjpegTurbo], logLevel: 'silent' });
  return import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
}
const { createPainter } = await load('packages/transcoder/src/preview/paint.ts');
const { decodeJpeg } = await load('packages/transcoder/src/media/jpeg.ts');
const photo = await readFile('packages/transcoder/test/images/baseline-444.jpg');

test('pattern 里的图片画上，同一张图两页只要一次；pattern 外的图片照常按占位地址交给 resvg', async () => {
  const painter = await createPainter(await readFile('node_modules/@resvg/resvg-wasm/index_bg.wasm'));
  const asked = [];
  const res = {
    font: async () => undefined,
    image: async (h) => { asked.push(h); return h === 'media/a.jpg' || h === 'media/b.jpg' ? photo : undefined; },
    template: async () => undefined,
    raster: async () => undefined,
  };
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><defs><pattern id="p" patternUnits="userSpaceOnUse" width="100" height="50">'
    + '<image href="media/a.jpg" width="100" height="50" preserveAspectRatio="none"/></pattern></defs><rect width="100" height="50" fill="url(#p)"/>'
    + '<image href="media/b.jpg" y="50" width="100" height="50" preserveAspectRatio="none"/><image href="media/none.jpg" width="1" height="1"/></svg>';
  const pix = [];
  for (const page of [1, 2]) {
    const r = await painter.paint({ conv: 'pattern', page, main: { svg, fonts: [] }, picWidth: 100, thumbWidth: 50, thumbHeight: 50 }, res);
    assert.deepEqual(r.warnings, []);
    pix.push(decodeJpeg(r.pic));
  }
  assert.equal(asked.filter((h) => h === 'media/a.jpg').length, 1, 'pattern 里的图片只要一次');
  assert.equal(asked.filter((h) => h === 'media/b.jpg').length, 2, 'pattern 外的图片每页由 resvg 要');
  const ref = decodeJpeg(photo);
  for (const img of pix) {
    // 上半（pattern）和下半（普通图片）画的是同一张图：两块的平均色和原图接近，不是白底
    for (const [y0, y1] of [[0, 50], [50, 100]]) {
      let sum = 0, n = 0;
      for (let y = y0 + 5; y < y1 - 5; y++) for (let x = 5; x < 95; x++) { sum += img.data[(y * img.width + x) * 3]; n++; }
      let rs = 0;
      for (let i = 0; i < ref.data.length; i += 3) rs += ref.data[i];
      assert.ok(Math.abs(sum / n - rs / (ref.data.length / 3)) < 25, `第 ${y0} 行起的平均色接近原图`);
    }
  }
});
