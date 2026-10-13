// 图片"设置透明色"在原图上抠：PNG 的 tRNS 块和带透明通道的逐像素处理（源码用 esbuild 现场打包后测试）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';
import { build } from 'esbuild';

async function load(entry) {
  const r = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent' });
  return import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
}
const { pngColorKey } = await load('packages/transcoder/src/media/png-key.ts');

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, c]);
}
function png(w, h, depth, type, raw, extra = []) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = depth; ihdr[9] = type;
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), ...extra, chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
function chunks(b) {
  const out = [];
  for (let o = 8; o < b.length;) {
    const len = Buffer.from(b.buffer, b.byteOffset + o, 4).readUInt32BE();
    const type = String.fromCharCode(...b.subarray(o + 4, o + 8));
    const data = b.subarray(o + 8, o + 8 + len);
    assert.equal(Buffer.from(b.buffer, b.byteOffset + o + 8 + len, 4).readUInt32BE(), crc(b.subarray(o + 4, o + 8 + len)), `${type} 的 CRC`);
    out.push({ type, data });
    o += 12 + len;
  }
  return out;
}
const white = { r: 255, g: 255, b: 255, a: 1 };

test('真彩色：加 tRNS 块，像素数据不动', async () => {
  const raw = Buffer.from([0, 255, 255, 255, 10, 20, 30]);
  const src = png(2, 1, 8, 2, raw);
  const out = await pngColorKey(src, white);
  const cs = chunks(out);
  assert.deepEqual(cs.map((c) => c.type), ['IHDR', 'tRNS', 'IDAT', 'IEND']);
  assert.deepEqual([...cs[1].data], [0, 255, 0, 255, 0, 255]);
  assert.deepEqual([...inflateSync(cs[2].data)], [...raw]);
});

test('调色板：和目标色每个通道差不超过 1 的都变透明，原有的透明度保留', async () => {
  const plte = Buffer.from([254, 255, 255, 0, 0, 0, 255, 255, 255, 250, 250, 250]);
  const src = png(4, 1, 8, 3, Buffer.from([0, 0, 1, 2, 3]), [chunk('PLTE', plte), chunk('tRNS', Buffer.from([255, 128]))]);
  const cs = chunks(await pngColorKey(src, white));
  assert.deepEqual(cs.map((c) => c.type), ['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND']);
  assert.deepEqual([...cs[2].data], [0, 128, 0]);
});

test('带透明通道：五种行过滤都能还原，接近目标色的像素透明度变 0', async () => {
  // 3 x 5 的 RGBA，每行用一种过滤方式编码
  const w = 3, h = 5, bpp = 4;
  const px = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.push(...((x + y) % 2 ? [255, 254, 255, 200] : [40 + x * 30, 80 + y * 20, 120, 255]));
  const rows = [];
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < h; y++) {
    const cur = px.slice(y * w * bpp, (y + 1) * w * bpp), up = y ? px.slice((y - 1) * w * bpp, y * w * bpp) : new Array(w * bpp).fill(0);
    const f = y % 5;
    rows.push(f, ...cur.map((v, i) => {
      const a = i >= bpp ? cur[i - bpp] : 0, b = up[i], c = i >= bpp ? up[i - bpp] : 0;
      const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][f];
      return (v - pred) & 0xff;
    }));
  }
  const out = chunks(await pngColorKey(png(w, h, 8, 6, Buffer.from(rows)), white));
  // 输出每行可能用不同的过滤方式：按规范还原后再比
  const data = inflateSync(Buffer.concat(out.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const dec = [];
  for (let y = 0; y < h; y++) {
    const f = data[y * (w * bpp + 1)];
    assert.ok(f <= 4, '过滤方式');
    const up = y ? dec.slice((y - 1) * w * bpp, y * w * bpp) : new Array(w * bpp).fill(0);
    for (let i = 0; i < w * bpp; i++) {
      const a = i >= bpp ? dec[y * w * bpp + i - bpp] : 0, b = up[i], c = i >= bpp ? up[i - bpp] : 0;
      const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][f];
      dec.push((data[y * (w * bpp + 1) + 1 + i] + pred) & 0xff);
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const j = (y * w + x) * bpp;
      assert.deepEqual(dec.slice(j, j + 3), px.slice(j, j + 3));
      assert.equal(dec[j + 3], (x + y) % 2 ? 0 : 255);
    }
  }
});

test('做不了的返回 undefined：不是 PNG、灰度图配彩色目标、16 位带透明通道', async () => {
  assert.equal(await pngColorKey(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0]), white), undefined);
  assert.equal(await pngColorKey(png(1, 1, 8, 0, Buffer.from([0, 9])), { r: 255, g: 0, b: 0, a: 1 }), undefined);
  assert.equal(await pngColorKey(png(1, 1, 16, 6, Buffer.alloc(9)), white), undefined);
  assert.equal(await pngColorKey(png(1, 1, 8, 6, Buffer.from([0, 1, 2])), white), undefined, '数据不够');
});
