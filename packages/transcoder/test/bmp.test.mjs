// BMP 解码（出图时转 PNG：resvg 不认 BMP）：各种位深、位域、调色板、RLE、上下方向（源码用 esbuild 现场打包后测试）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const r = await build({ entryPoints: ['packages/transcoder/src/media/bmp.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent' });
const { decodeBmp, bmpToPng } = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));

/** 拼一个 BMP：header 是 40 字节以后的额外内容（掩码等），palette 是 BGRA 列表，rows 是按文件顺序的每行字节 */
function bmp({ w, h, bpp, comp = 0, hs = 40, extra = [], palette = [], rows }) {
  const stride = ((w * bpp + 31) >> 5) * 4;
  const body = rows.map((row) => { const b = Buffer.alloc(stride); Buffer.from(row).copy(b); return b; });
  const pal = Buffer.from(palette.flat());
  // 40 字节的文件头时掩码跟在文件头后面（写进同一块）
  const head = Buffer.alloc(Math.max(hs, 40 + extra.length * 4));
  head.writeUInt32LE(hs, 0); head.writeInt32LE(w, 4); head.writeInt32LE(h, 8); head.writeUInt16LE(1, 12); head.writeUInt16LE(bpp, 14);
  head.writeUInt32LE(comp, 16); head.writeUInt32LE(palette.length, 32);
  extra.forEach((v, i) => head.writeUInt32LE(v >>> 0, 40 + i * 4));
  const off = 14 + head.length + pal.length;
  const data = comp === 1 || comp === 2 ? Buffer.from(rows.flat()) : Buffer.concat(body);
  const f = Buffer.alloc(14);
  f.write('BM', 0); f.writeUInt32LE(off + data.length, 2); f.writeUInt32LE(off, 10);
  return new Uint8Array(Buffer.concat([f, head, pal, data]));
}
const px = (img, x, y) => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

test('24 位：从下往上存；负高度是从上往下', () => {
  const rows = [[0, 0, 255, 0, 255, 0], [255, 0, 0, 255, 255, 255]];
  const up = decodeBmp(bmp({ w: 2, h: 2, bpp: 24, rows }));
  assert.deepEqual(px(up, 0, 1), [255, 0, 0, 255], '文件第一行是最下面一行');
  assert.deepEqual(px(up, 1, 0), [255, 255, 255, 255]);
  const down = decodeBmp(bmp({ w: 2, h: -2, bpp: 24, rows }));
  assert.deepEqual(px(down, 0, 0), [255, 0, 0, 255]);
  assert.equal(up.alpha, false);
});

test('32 位不带位域：第四个字节不当透明度；V4 文件头带透明度掩码：用透明度', () => {
  const plain = decodeBmp(bmp({ w: 1, h: 1, bpp: 32, rows: [[10, 20, 30, 0]] }));
  assert.deepEqual(px(plain, 0, 0), [30, 20, 10, 255]);
  const v4 = decodeBmp(bmp({ w: 1, h: 1, bpp: 32, comp: 3, hs: 108, extra: [0xff0000, 0xff00, 0xff, 0xff000000], rows: [[10, 20, 30, 128]] }));
  assert.deepEqual(px(v4, 0, 0), [30, 20, 10, 128]);
  assert.equal(v4.alpha, true);
});

test('16 位：默认 555，位域 565', () => {
  const v = (0x1f << 10) | (0x10 << 5);
  const a = decodeBmp(bmp({ w: 1, h: 1, bpp: 16, rows: [[v & 255, v >> 8]] }));
  assert.deepEqual(px(a, 0, 0), [255, 132, 0, 255]);
  const v2 = 0xf800 | 0x07e0;
  const b = decodeBmp(bmp({ w: 1, h: 1, bpp: 16, comp: 3, extra: [0xf800, 0x07e0, 0x001f], rows: [[v2 & 255, v2 >> 8]] }));
  // 40 字节文件头时掩码跟在后面
  assert.deepEqual(px(b, 0, 0), [255, 255, 0, 255]);
});

test('1 位、8 位调色板；RLE8、RLE4', () => {
  const pal = [[0, 0, 0, 0], [255, 255, 255, 0]];
  const mono = decodeBmp(bmp({ w: 3, h: 1, bpp: 1, palette: pal, rows: [[0b10100000]] }));
  assert.deepEqual([px(mono, 0, 0)[0], px(mono, 1, 0)[0], px(mono, 2, 0)[0]], [255, 0, 255]);
  const pal8 = [[0, 0, 255, 0], [0, 255, 0, 0], [255, 0, 0, 0]];
  const p8 = decodeBmp(bmp({ w: 2, h: 1, bpp: 8, palette: pal8, rows: [[2, 1]] }));
  assert.deepEqual(px(p8, 0, 0), [0, 0, 255, 255]);
  // RLE8：第一行 3 个 1 号色、换行、第二行不压缩的 2 个像素（2、0），结束
  const rle8 = decodeBmp(bmp({ w: 3, h: 2, bpp: 8, comp: 1, palette: pal8, rows: [[3, 1, 0, 0, 0, 3, 2, 0, 0, 0, 0, 1]] }));
  assert.deepEqual(px(rle8, 2, 1), [0, 255, 0, 255], '第一行在最下面');
  assert.deepEqual(px(rle8, 0, 0), [0, 0, 255, 255]);
  assert.deepEqual(px(rle8, 2, 0), [255, 0, 0, 255], '没写到的是 0 号色');
  // RLE4：4 个像素交替 2、1
  const rle4 = decodeBmp(bmp({ w: 4, h: 1, bpp: 4, comp: 2, palette: pal8, rows: [[4, 0x21, 0, 1]] }));
  assert.deepEqual([0, 1, 2, 3].map((x) => px(rle4, x, 0)[2]), [255, 0, 255, 0]);
});

test('转成 PNG：没有透明度的出 RGB；里面存 PNG 的原样取出', async () => {
  const png = await bmpToPng(bmp({ w: 2, h: 1, bpp: 24, rows: [[0, 0, 255, 0, 255, 0]] }));
  assert.deepEqual([...png.subarray(1, 4)], [0x50, 0x4e, 0x47]);
  assert.equal(png[25], 2, 'RGB');
  const inner = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const wrapped = bmp({ w: 1, h: 1, bpp: 0, comp: 5, rows: [] });
  const full = new Uint8Array([...wrapped, ...inner]);
  assert.deepEqual([...await bmpToPng(full)], [...inner]);
  assert.equal(decodeBmp(new Uint8Array([0x42, 0x4d])), undefined);
});
