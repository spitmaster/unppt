// JPEG 解码（"设置透明色"在原图上抠用）：和 Pillow 的解码结果对照（源码用 esbuild 现场打包后测试）。
// test/images 里是生成的中性图案（渐变、矩形、圆、斜线），.rgb 是 Pillow 解出的像素
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { build } from 'esbuild';

async function load(entry) {
  const r = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent' });
  return import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
}
const { decodeJpeg } = await load('packages/transcoder/src/media/jpeg.ts');
const { colorKey } = await load('packages/transcoder/src/media/color-key.ts');
const DIR = new URL('./images/', import.meta.url);

/** 平均误差和最大误差；有色度下采样的图在右边、下边缘个别像素差得多（libjpeg 在实际宽度处截断，这里按补齐的块） */
const CASES = [
  ['baseline-444', 1.2, 6], ['progressive-444', 1.2, 6], ['gray', 1.2, 6],
  ['baseline-420', 0.3, 30], ['baseline-422', 0.3, 30], ['progressive', 0.3, 30], ['restart', 0.3, 30], ['cmyk', 0.3, 4],
];

for (const [name, meanMax, maxMax] of CASES) {
  test(`JPEG 解码：${name}`, async () => {
    const jpg = new Uint8Array(await readFile(new URL(`${name}.jpg`, DIR)));
    const ref = new Uint8Array(await readFile(new URL(`${name}.rgb`, DIR)));
    const img = decodeJpeg(jpg);
    assert.ok(img, '解不开');
    assert.equal(img.width, 52);
    assert.equal(img.height, 37);
    assert.equal(img.data.length, ref.length);
    let sum = 0, max = 0;
    for (let i = 0; i < ref.length; i++) { const d = Math.abs(img.data[i] - ref[i]); sum += d; max = Math.max(max, d); }
    const mean = sum / ref.length;
    assert.ok(mean <= meanMax && max <= maxMax, `平均误差 ${mean.toFixed(2)}，最大 ${max}`);
  });
}

test('JPEG 抠色：白色 ±16 变透明，输出 PNG', async () => {
  const jpg = new Uint8Array(await readFile(new URL('baseline-444.jpg', DIR)));
  const png = await colorKey(jpg, { r: 255, g: 255, b: 255, a: 1 });
  assert.ok(png);
  assert.deepEqual([...png.subarray(1, 4)], [80, 78, 71]);
  // 解出 IDAT 看透明度：图里白色矩形（5..25, 5..20）的中间透明，红色圆的中间不透明
  let o = 8; const idat = [];
  let w = 0;
  while (o < png.length) {
    const len = Buffer.from(png.buffer, png.byteOffset + o, 4).readUInt32BE();
    const type = String.fromCharCode(...png.subarray(o + 4, o + 8));
    if (type === 'IHDR') w = Buffer.from(png.buffer, png.byteOffset + o + 8, 4).readUInt32BE();
    if (type === 'IDAT') idat.push(png.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  // 按 PNG 规范还原行过滤
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * 4, px = new Uint8Array(raw.length);
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y * (stride + 1) < raw.length; y++) {
    const f = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? px[y * stride + i - 4] : 0, b = y ? px[(y - 1) * stride + i] : 0, c = y && i >= 4 ? px[(y - 1) * stride + i - 4] : 0;
      px[y * stride + i] = (raw[y * (stride + 1) + 1 + i] + [0, a, b, (a + b) >> 1, paeth(a, b, c)][f]) & 0xff;
    }
  }
  const alpha = (x, y) => px[y * stride + x * 4 + 3];
  assert.equal(alpha(15, 12), 0);
  assert.equal(alpha(38, 19), 255);
});

test('解不开的返回 undefined：不是 JPEG、截断、算术编码', () => {
  assert.equal(decodeJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), undefined);
  assert.equal(decodeJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x30])), undefined);
  assert.equal(decodeJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xc9, 0x00, 0x0b, 8, 0, 1, 0, 1, 1, 1, 0x11, 0])), undefined);
});
