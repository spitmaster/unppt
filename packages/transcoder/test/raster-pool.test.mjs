// 并行出图（Node 工作线程池）：和本线程画的整页图、缩略图逐字节一致（只用合成测试用例）。先 npm run build，再 npm test。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { convert } from '../dist/index.js';
import { autoWorkers, createRasterPool } from '../dist/node.js';

const TC = new URL('../../../testcases/', import.meta.url);

async function images(name, options) {
  const files = new Map();
  const write = async (path, data) => { if (/^(pic|thum)\//.test(path)) files.set(path, Buffer.from(data)); };
  const r = await convert(new Uint8Array(await readFile(new URL(name, TC))), { write, output: 'paged', ...options });
  files.warnings = r.report.warnings;
  return files;
}

test('线程池画的和本线程画的逐字节一致（背景层、嵌入字体、嵌套 SVG 图片、效果）', async () => {
  const wasm = new Uint8Array(await readFile(new URL('../dist/resvg.wasm', import.meta.url)));
  const pool = await createRasterPool(wasm, 3);
  try {
    // theme-*.pptx 含微软主题素材、不进仓库（有 Office 的人用 make.py 生成），没有时跳过（GitHub 上的自动发布就没有）
    const names = ['theme-ion.pptx', 'theme-gallery.pptx', 'text-embedded-fonts.pptx', 'svg-images.pptx', 'shape-effects.pptx', 'pictures.pptx', 'emf-images.pptx', 'pictures-tiff.pptx']
      .filter((n) => existsSync(new URL(n, TC)));
    for (const name of names) {
      const local = await images(name, { rasterWasm: wasm });
      const pooled = await images(name, { rasterPool: pool });
      assert.ok(local.size >= 2, name);
      assert.deepEqual([...pooled.keys()].sort(), [...local.keys()].sort(), name);
      for (const [k, v] of local) assert.ok(v.equals(pooled.get(k)), `${name} ${k}`);
      assert.deepEqual(pooled.warnings, local.warnings, `${name} 警告`);
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

test('resvg 在一个线程里出错很多次后换新线程：之后的页照常画，不卡住、不丢页', async () => {
  const wasm = new Uint8Array(await readFile(new URL('../dist/resvg.wasm', import.meta.url)));
  const pool = await createRasterPool(wasm, 1);
  try {
    const f = '<filter id="f" filterUnits="userSpaceOnUse" x="-30" y="-30" width="300" height="200"><feGaussianBlur in="SourceAlpha" stdDeviation="5"/></filter>';
    // 60 个画布外很远、带阴影的元素（每个单独都会让 resvg 崩溃）：一页找的时候出错约 7 次，20 页超过换线程的次数
    const far = Array.from({ length: 60 }, (_, k) => `<g transform="translate(${2100 + k * 10} 30)"><g filter="url(#f)"><rect width="20" height="20"/></g></g>`).join('');
    const crashy = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540" width="720" height="405"><defs>${f}</defs>${far}</svg>`;
    const plain = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540" width="720" height="405"><rect width="100" height="100" fill="red"/></svg>';
    const res = { font: async () => undefined, image: async () => undefined, template: async () => undefined, raster: async () => undefined };
    const job = (page, svg) => ({ conv: 'retire', page, main: { svg, fonts: [] }, picWidth: 1280, thumbWidth: 216, thumbHeight: 122 });
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => pool.paint(job(i + 1, crashy), res)).concat([pool.paint(job(21, plain), res)]));
    for (const r of results) assert.ok(r.pic, r.warnings.join('\n'));
    const again = await pool.paint(job(22, plain), res);
    assert.ok(again.pic);
    assert.deepEqual(again.warnings, []);
  } finally {
    await pool.close();
  }
});
