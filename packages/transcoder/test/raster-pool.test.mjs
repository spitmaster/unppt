// 并行出图（Node 工作线程池）：和本线程画的整页图、缩略图逐字节一致（只用合成测试用例）。先 npm run build，再 npm test。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { convert } from '../dist/index.js';
import { autoWorkers, createRasterPool } from '../dist/node.js';

const TC = new URL('../../../testcases/', import.meta.url);

async function images(name, options) {
  const files = new Map();
  const write = async (path, data) => { if (/^(pic|thum)\//.test(path)) files.set(path, Buffer.from(data)); };
  await convert(new Uint8Array(await readFile(new URL(name, TC))), { write, output: 'paged', ...options });
  return files;
}

test('线程池画的和本线程画的逐字节一致（背景层、嵌入字体、嵌套 SVG 图片、效果）', async () => {
  const wasm = new Uint8Array(await readFile(new URL('../dist/resvg.wasm', import.meta.url)));
  const pool = await createRasterPool(wasm, 3);
  try {
    for (const name of ['theme-ion.pptx', 'theme-gallery.pptx', 'text-embedded-fonts.pptx', 'svg-images.pptx', 'shape-effects.pptx', 'pictures.pptx']) {
      const local = await images(name, { rasterWasm: wasm });
      const pooled = await images(name, { rasterPool: pool });
      assert.ok(local.size >= 2, name);
      assert.deepEqual([...pooled.keys()].sort(), [...local.keys()].sort(), name);
      for (const [k, v] of local) assert.ok(v.equals(pooled.get(k)), `${name} ${k}`);
    }
  } finally {
    await pool.close();
  }
});

test('自动线程数至少 1', () => {
  assert.ok(autoWorkers() >= 1);
});
