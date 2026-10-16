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

test('不调 close() 时，空闲的线程不拦着进程退出（只有一页、启动了两个线程）', async () => {
  const { execFile } = await import('node:child_process');
  const script = `import { readFile } from 'node:fs/promises';
import { convert } from ${JSON.stringify(new URL('../dist/index.js', import.meta.url).href)};
import { createRasterPool } from ${JSON.stringify(new URL('../dist/node.js', import.meta.url).href)};
const wasm = new Uint8Array(await readFile(new URL(${JSON.stringify(new URL('../dist/resvg.wasm', import.meta.url).href)})));
const pool = await createRasterPool(wasm, 4);
let pics = 0;
await convert(new Uint8Array(await readFile(new URL(${JSON.stringify(new URL('anim-basic.pptx', TC).href)}))), { write: async (p) => { if (p.startsWith('pic/')) pics++; }, output: 'paged', rasterPool: pool });
console.log('pics', pics);`;
  const code = await new Promise((resolve) => {
    const child = execFile(process.execPath, ['--input-type=module', '-e', script], { timeout: 20000 }, (err, stdout) => resolve({ err, stdout }));
    void child;
  });
  assert.equal(code.err, null, '进程应该自己退出');
  assert.match(code.stdout, /pics [1-9]/);
});

test('close() 时还没画完的页都结束（记警告），之后再来的页直接结束', async () => {
  const wasm = new Uint8Array(await readFile(new URL('../dist/resvg.wasm', import.meta.url)));
  const pool = await createRasterPool(wasm, 2);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><rect width="100" height="100" fill="#c33"/></svg>';
  const job = (page) => ({ conv: 'x', page, main: { svg, fonts: [] }, picWidth: 100, thumbWidth: 50, thumbHeight: 50 });
  const res = { font: async () => undefined, image: async () => undefined, template: async () => undefined };
  const all = Array.from({ length: 10 }, (_, i) => pool.paint(job(i + 1), res));
  await pool.close();
  const results = await Promise.all(all);
  assert.equal(results.length, 10);
  assert.ok(results.some((r) => r.warnings.some((w) => w.includes('已关闭'))));
  const late = await pool.paint(job(11), res);
  assert.ok(late.warnings.some((w) => w.includes('已关闭')));
});
