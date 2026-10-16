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

test('损坏的 JPEG（随机改字节、截断）不会出错、不会卡住', async () => {
  const names = ['baseline-420', 'progressive', 'restart', 'cmyk'];
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const t0 = Date.now();
  for (const name of names) {
    const src = new Uint8Array(await readFile(new URL(`${name}.jpg`, DIR)));
    for (let k = 0; k < 150; k++) {
      let b = src.slice();
      if (k % 3 === 0) b = b.subarray(0, Math.floor(rnd() * b.length));
      const flips = 1 + Math.floor(rnd() * 8);
      for (let f = 0; f < flips && b.length; f++) b[Math.floor(rnd() * b.length)] = Math.floor(rnd() * 256);
      const img = decodeJpeg(b);
      if (img) assert.equal(img.data.length, img.width * img.height * 3);
      await colorKey(b, { r: 255, g: 255, b: 255, a: 1 });
    }
  }
  assert.ok(Date.now() - t0 < 20000, '太慢');
});

// 按 1/8 解码（每块只存 DC、渐进式的交流扫描整段跳过）：和全尺寸解码后每个 8×8 块求平均接近（只比完整的块，右、下边缘不满 8 像素的不比）。
// 色度抽样的图色度只有 1/16 精度、再放大，误差本来就大（和改成只存 DC 之前逐字节相同）
for (const [name] of CASES) {
  test(`JPEG 按 1/8 解码：${name}`, async () => {
    const jpg = new Uint8Array(await readFile(new URL(`${name}.jpg`, DIR)));
    const full = decodeJpeg(jpg);
    const small = decodeJpeg(jpg, 1);
    assert.ok(full && small, '解不开');
    assert.equal(small.width, Math.ceil(full.width / 8));
    assert.equal(small.height, Math.ceil(full.height / 8));
    let sum = 0, n = 0;
    for (let by = 0; by < Math.floor(full.height / 8); by++) for (let bx = 0; bx < Math.floor(full.width / 8); bx++) for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) s += full.data[((by * 8 + y) * full.width + bx * 8 + x) * 3 + c];
      sum += Math.abs(s / 64 - small.data[(by * small.width + bx) * 3 + c]);
      n++;
    }
    const limit = /42[02]|^progressive$|restart/.test(name) ? 14 : 4;
    assert.ok(sum / n <= limit, `平均误差 ${(sum / n).toFixed(2)}`);
  });
}
