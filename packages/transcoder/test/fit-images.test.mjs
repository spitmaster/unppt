// 整页图里位图按画的大小先低通缩小（preview/drawn-size.ts 算大小、preview/fit-images.ts 缩小；源码用 esbuild 现场打包后测试）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { build } from 'esbuild';
import { libjpegTurbo } from '../../../scripts/esbuild-libjpeg.mjs';

async function load(entry) {
  const r = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], loader: { '.wasm': 'binary' }, plugins: [libjpegTurbo], logLevel: 'silent' });
  return import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
}
const { drawnSizes } = await load('packages/transcoder/src/preview/drawn-size.ts');
const { fitSize, fitTarget, fitImage, downsample } = await load('packages/transcoder/src/preview/fit-images.ts');
const { encodePixels, encodeStored } = await load('packages/transcoder/src/media/png.ts');
const { jpegEncoder } = await load('packages/transcoder/src/media/jpeg-encode.ts');

/** 8 位、不隔行的 PNG 解成像素（只认过滤方式 0，encodeStored 的输出） */
function decodeStored(png) {
  let o = 8, w = 0, h = 0, ch = 0;
  const idat = [];
  while (o < png.length) {
    const len = Buffer.from(png.buffer, png.byteOffset + o, 4).readUInt32BE();
    const type = String.fromCharCode(...png.subarray(o + 4, o + 8));
    const d = Buffer.from(png.buffer, png.byteOffset + o + 8, len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ch = d[9] === 6 ? 4 : 3; }
    if (type === 'IDAT') idat.push(d);
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = w * ch, px = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    assert.equal(raw[y * (stride + 1)], 0);
    px.set(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), y * stride);
  }
  return { width: w, height: h, ch, data: px };
}

test('画的大小跟着变换走：transform、嵌套 svg 的 viewBox、use、图案（含 patternTransform）', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
<defs><pattern id="p1" patternUnits="userSpaceOnUse" width="100" height="50"><image href="media/a.png" width="100" height="50" preserveAspectRatio="none"/></pattern>
<image id="b1" href="data:image/bmp;base64,AAA" width="1" height="1" preserveAspectRatio="none"/>
<pattern id="p2" patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="matrix(2 0 0 2 0 0)"><rect fill="url(#p1)" width="10" height="10"/></pattern></defs>
<g transform="translate(10 10) scale(0.5)"><image href="media/b.jpg" x="0" y="0" width="400" height="300" preserveAspectRatio="none"/></g>
<g transform="rotate(90)"><rect width="10" height="10" fill="url(#p1)"/></g>
<rect width="10" height="10" fill="url(#p2)"/>
<g><svg x="0" y="0" width="200" height="100" viewBox="0 0 400 200"><use href="#b1" transform="matrix(40 0 0 20 0 0)"/></svg></g>
<image href="media/c.png" width="50" height="50"/>
<!-- <image href="media/comment.png" width="9" height="9"/> -->
<pattern id="p3" patternContentUnits="objectBoundingBox"><image href="media/d.png" width="1" height="1"/></pattern>
<rect fill="url(#p3)" width="5" height="5"/>
<filter id="f"><feImage href="media/e.png"/></filter><image href="media/e.png" width="10" height="10"/>
</svg>`;
  const s = drawnSizes(svg, 960);
  // 按 <image> 标签在 SVG 里的位置取
  const at = (href) => s.get(svg.indexOf(`<image href="${href}"`));
  // 整体缩放 960 / 1280 = 0.75
  assert.deepEqual(at('media/b.jpg'), [{ w: 150, h: 112.5, fit: 'none' }]);
  // 转 90° 不改变沿图片自己方向的长度；patternTransform 放大 2 倍的那处再大一倍
  assert.deepEqual(at('media/a.png'), [{ w: 75, h: 37.5, fit: 'none' }, { w: 150, h: 75, fit: 'none' }]);
  // 嵌套 svg 缩一半，use 拉到 40 × 20
  assert.deepEqual(s.get(svg.indexOf('<image id="b1"')), [{ w: 15, h: 7.5, fit: 'none' }]);
  assert.deepEqual(at('media/c.png'), [{ w: 37.5, h: 37.5, fit: 'meet' }]);
  assert.equal(s.has(svg.indexOf('<image href="media/comment.png"')), false, '注释里的不算');
  assert.equal(at('media/d.png'), null, 'objectBoundingBox 单位的图案内容算不出来');
  assert.deepEqual(at('media/e.png'), [{ w: 7.5, h: 7.5, fit: 'meet' }], '同一张图 feImage 也用到时，<image> 元素照样按自己画的大小');
  assert.equal(drawnSizes('<svg width="10" height="10"><rect/></svg>', 10).size, 0);
});

test('变换写法认不出来、use 引用的元素父级矩阵不可逆时记 null（不缩）', () => {
  const svg = `<svg width="100" height="100" viewBox="0 0 100 100"><g transform="foo(1)"><image href="a.png" width="10" height="10"/></g>
<g transform="scale(0)"><image id="z" href="b.png" width="10" height="10"/></g><use href="#z"/></svg>`;
  const s = drawnSizes(svg, 100);
  assert.equal(s.get(svg.indexOf('<image href="a.png"')), null);
  assert.equal(s.get(svg.indexOf('<image id="z"')), null);
});

test('同一张图在一页里画成几种大小：每个元素各算各的', () => {
  const svg = `<svg width="100" height="100" viewBox="0 0 100 100"><image href="a.png" width="40" height="20"/><image href="a.png" y="50" width="10" height="5"/></svg>`;
  const s = drawnSizes(svg, 100);
  assert.deepEqual(s.get(svg.indexOf('<image')), [{ w: 40, h: 20, fit: 'meet' }]);
  assert.deepEqual(s.get(svg.lastIndexOf('<image')), [{ w: 10, h: 5, fit: 'meet' }]);
});

test('要缩到多大：各处取最大；meet 按原图比例；画的大小在原图 0.7 倍以上不缩', () => {
  assert.deepEqual(fitSize(1000, 500, [{ w: 200, h: 100, fit: 'none' }, { w: 300, h: 80, fit: 'none' }]), { w: 300, h: 100 });
  assert.deepEqual(fitSize(1000, 500, [{ w: 200, h: 200, fit: 'meet' }]), { w: 200, h: 100 });
  assert.equal(fitSize(1000, 500, [{ w: 800, h: 400, fit: 'none' }]), undefined);
  assert.equal(fitSize(1000, 500, [{ w: 2000, h: 1000, fit: 'none' }, { w: 10, h: 10, fit: 'none' }]), undefined, '有一处画得比原图还大');
  assert.deepEqual(fitSize(1000, 500, [{ w: 300.2, h: 3000, fit: 'none' }]), { w: 301, h: 500 }, '只有一个方向缩小也缩，另一个方向不放大');
});

test('按小数比例缩小（帐篷权重）：1 像素的黑白条纹缩成接近均匀的灰，3 像素缩成 2 像素按权重混合', () => {
  const w = 300, h = 10;
  const src = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) src.fill(x % 2 ? 255 : 0, (y * w + x) * 3, (y * w + x) * 3 + 3);
  // 偶数倍正好是 127.5；1/3 时相邻两列交替差 ±14.5（只按面积平均是 2 黑 1 白、1 黑 2 白：±42.5）；两头的列帐篷截断后重新归一，差得多一点
  for (const [tw, tol] of [[150, 1], [75, 1], [100, 15], [120, 6], [37, 1]]) {
    const out = downsample(src, w, h, 3, tw, 5);
    for (let y = 0; y < 5; y++) for (let x = 0; x < tw; x++) {
      const v = out[(y * tw + x) * 3];
      assert.ok(Math.abs(v - 127.5) <= (x === 0 || x === tw - 1 ? 20 : tol), `缩到 ${tw}，第 ${x} 列：${v}`);
    }
  }
  const out = downsample(new Uint8Array([0, 0, 0, 90, 90, 90, 180, 180, 180]), 3, 1, 3, 2, 1);
  assert.deepEqual([...out], [34, 34, 34, 146, 146, 146]);
  // 透明像素的颜色不渗进来：红色不透明 + 绿色全透明 -> 红色半透明
  const rgba = downsample(new Uint8Array([255, 0, 0, 255, 0, 255, 0, 0]), 2, 1, 4, 1, 1);
  assert.deepEqual([...rgba], [255, 0, 0, 128]);
});

test('不压缩的 PNG：zlib 能解开、像素原样', () => {
  const px = new Uint8Array(70000 * 3).map((_, i) => (i * 7) & 255);
  const png = encodeStored(px, 700, 100, 3);
  const d = decodeStored(png);
  assert.equal(d.width, 700);
  assert.deepEqual(d.data, px);
});

test('PNG、JPEG 按目标大小缩：条纹图缩到 1/4 后是均匀的灰（两头的列除外）；没缩小到 0.7 倍以下的不处理', async () => {
  const w = 400, h = 200;
  const rgba = new Uint8Array(w * h * 4), rgb = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) { const v = (i % w) % 2 ? 255 : 0; rgba.set([v, v, v, 255], i * 4); rgb.fill(v, i * 3, i * 3 + 3); }
  const png = await encodePixels(rgb, w, h, 3);
  const t = fitTarget(png, [{ w: 100, h: 50, fit: 'none' }]);
  assert.deepEqual(t, { w: 100, h: 50 });
  const out = decodeStored(await fitImage(png, t));
  assert.equal(out.width, 100);
  assert.equal(out.ch, 3, '原图不透明，出 RGB');
  for (const v of out.data) assert.ok(Math.abs(v - 128) <= 1, `PNG：${v}`);
  assert.equal(fitTarget(png, [{ w: 300, h: 150, fit: 'none' }]), undefined);
  const jpg = (await jpegEncoder())(rgba, w, h, 95);
  const o2 = decodeStored(await fitImage(jpg, fitTarget(jpg, [{ w: 100, h: 50, fit: 'none' }])));
  assert.equal(o2.width, 100);
  // JPEG 全尺寸解码后直接按帐篷权重缩：左右两头的列帐篷截断后重新归一，条纹图上差得多一点
  for (let i = 0; i < o2.data.length; i++) {
    const x = Math.floor(i / 3) % 100;
    assert.ok(Math.abs(o2.data[i] - 128) <= (x === 0 || x === 99 ? 12 : 1), `JPEG 第 ${x} 列：${o2.data[i]}`);
  }
  assert.equal(fitTarget(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 100, 0, 100, 0]), [{ w: 1, h: 1, fit: 'none' }]), undefined, 'GIF 不缩');
});
