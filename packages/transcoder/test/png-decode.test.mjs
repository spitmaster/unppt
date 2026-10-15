// PNG 解码（缩略图缩小图片用）：各种颜色类型、位深、调色板透明、隔行，和 Pillow 解出的 RGBA 逐字节对照（源码用 esbuild 现场打包后测试）。
// test/images/png-* 是生成的中性渐变图案
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { build } from 'esbuild';

const r = await build({ entryPoints: ['packages/transcoder/src/media/png-decode.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent' });
const { decodePng } = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
const DIR = new URL('./images/', import.meta.url);

for (const f of (await readdir(DIR)).filter((n) => n.startsWith('png-') && n.endsWith('.png'))) {
  test(`PNG 解码：${f}`, async () => {
    const img = await decodePng(new Uint8Array(await readFile(new URL(f, DIR))));
    const want = new Uint8Array(await readFile(new URL(f.replace('.png', '.rgba'), DIR)));
    assert.ok(img, '解不出来');
    assert.equal(img.data.length, want.length);
    let diff = 0;
    for (let i = 0; i < want.length; i++) diff = Math.max(diff, Math.abs(img.data[i] - want[i]));
    assert.ok(diff <= 1, `最大差 ${diff}`);
  });
}
