// 转码器接口测试（只用合成测试用例）。先 npm run build，再 npm test。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, open, stat } from 'node:fs/promises';
import { convert } from '../dist/index.js';

const TC = new URL('../../../testcases/', import.meta.url);

/** 把输出收集到内存里 */
function memoryWriter() {
  const files = new Map();
  return {
    files,
    async write(path, data) {
      const parts = [];
      if (typeof data === 'string') parts.push(new TextEncoder().encode(data));
      else if (data instanceof Uint8Array) parts.push(data);
      else for await (const c of data) parts.push(c);
      files.set(path, Buffer.concat(parts));
    },
  };
}

function slidesOf(html) {
  return [...html.matchAll(/<script type="application\/json" class="unppt-slide">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
}

test('所有测试用例都能转码，页数正确', async () => {
  const names = (await readdir(TC)).filter((n) => n.endsWith('.pptx'));
  assert.ok(names.length >= 10);
  for (const n of names) {
    const ref = JSON.parse(await readFile(new URL(`${n.replace('.pptx', '')}/ref.json`, TC), 'utf8'));
    const w = memoryWriter();
    const r = await convert(await readFile(new URL(n, TC)), { write: w.write });
    const visible = ref.slides.filter((s) => !s.hidden).length;
    assert.equal(r.slides, visible, n);
    const html = w.files.get('index.html').toString('utf8');
    assert.ok(html.startsWith('<!doctype html>'), n);
    assert.equal(slidesOf(html).length, visible, n);
  }
});

test('按需读取（大文件模式）和整块读入的结果一致', async () => {
  const path = new URL('shapes-basic.pptx', TC);
  const size = (await stat(path)).size;
  const fh = await open(path, 'r');
  let reads = 0;
  const source = {
    size,
    async read(offset, length) {
      reads++;
      const buf = new Uint8Array(length);
      const { bytesRead } = await fh.read(buf, 0, length, offset);
      return buf.subarray(0, bytesRead);
    },
  };
  const a = memoryWriter();
  const b = memoryWriter();
  await convert(source, { write: a.write });
  await convert(await readFile(path), { write: b.write });
  await fh.close();
  assert.ok(reads > 0);
  assert.equal(a.files.get('index.html').toString(), b.files.get('index.html').toString());
});

test('点击动画编译成步骤；页面开始自动播放的动画不算点击', async () => {
  const w = memoryWriter();
  await convert(await readFile(new URL('anim-basic.pptx', TC)), { write: w.write });
  const [s] = slidesOf(w.files.get('index.html').toString());
  assert.equal(s.steps.length, 5);
  assert.deepEqual(s.steps[4].map((a) => a.dir), ['out']);
  assert.equal(s.hidden.length, 4);

  const w2 = memoryWriter();
  await convert(await readFile(new URL('anim-auto.pptx', TC)), { write: w2.write });
  const [s2] = slidesOf(w2.files.get('index.html').toString());
  assert.equal(s2.auto.length, 2);
  assert.equal(s2.steps.length, 1);
});

test('只输出数据模式：deck.json 结构完整', async () => {
  const w = memoryWriter();
  await convert(await readFile(new URL('table-basic.pptx', TC)), { write: w.write, output: 'data' });
  const deck = JSON.parse(w.files.get('deck.json').toString('utf8'));
  assert.equal(deck.format, 'unppt-deck');
  assert.equal(deck.version, 1);
  assert.equal(deck.slides.length, 1);
  assert.ok(deck.slides[0].svg.startsWith('<svg'));
  assert.ok(Array.isArray(deck.report.warnings));
});

test('损坏的文件给出明确错误', async () => {
  await assert.rejects(convert(new Uint8Array([1, 2, 3, 4]), { write: async () => {} }), /pptx/);
});
