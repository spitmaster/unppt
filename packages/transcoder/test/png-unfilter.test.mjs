// PNG 行过滤还原（media/png.ts 的 unfilter）：分过滤类型的快速写法和逐字节按规范算的结果一样（源码用 esbuild 现场打包后测试）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const r = await build({ entryPoints: ['packages/transcoder/src/media/png.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent' });
const { unfilter } = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));

/** 规范里的写法：逐字节取左、上、左上 */
function reference(f, src, up, bpp) {
  const row = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const a = i >= bpp ? row[i - bpp] : 0, b = up ? up[i] : 0, c = up && i >= bpp ? up[i - bpp] : 0;
    let p = 0;
    if (f === 1) p = a;
    else if (f === 2) p = b;
    else if (f === 3) p = (a + b) >> 1;
    else if (f === 4) {
      const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c);
      p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
    row[i] = (src[i] + p) & 0xff;
  }
  return row;
}

test('五种过滤、各种每像素字节数、有没有上一行：和规范的写法逐字节一样', () => {
  let seed = 1;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 16) & 0xff;
  for (const bpp of [1, 2, 3, 4, 6, 8]) {
    for (const len of [bpp, bpp * 7, 301]) {
      const src = Uint8Array.from({ length: len }, rnd), up = Uint8Array.from({ length: len }, rnd);
      for (let f = 0; f <= 4; f++) {
        for (const u of [undefined, up]) {
          const row = new Uint8Array(len);
          assert.equal(unfilter(f, src, row, u, bpp), true);
          assert.deepEqual(row, reference(f, src, u, bpp), `过滤 ${f}、bpp ${bpp}、长 ${len}、${u ? '有' : '没有'}上一行`);
        }
      }
    }
  }
  assert.equal(unfilter(5, new Uint8Array(3), new Uint8Array(3), undefined, 1), false);
});
