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

test('老格式 .ppt 给出明确提示', async () => {
  const ole = new Uint8Array(4096);
  ole.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  await assert.rejects(convert(ole, { write: async () => {} }), /老格式/);
});

test('恶意文件不能往页面里注入代码', async () => {
  // 把测试用例里的形状编号、文字、超链接改成注入代码，转码结果里不能出现可执行的属性或标签
  const src = await readFile(new URL('links.pptx', TC));
  const { inflateRawSync, deflateRawSync } = await import('node:zlib');
  // 简单的 zip 改写：找到 slide1.xml，替换内容后重新打包（只用于测试）
  const entries = readZip(src, inflateRawSync);
  const evil = '1&quot; onmouseover=&quot;alert(1)';
  let xml = entries.get('ppt/slides/slide1.xml').toString('utf8');
  xml = xml.replace(/<p:cNvPr id="\d+"/, `<p:cNvPr id="${evil}"`).replace(/<a:t>[^<]*<\/a:t>/, '<a:t>&lt;img src=x onerror=alert(1)&gt;</a:t>');
  entries.set('ppt/slides/slide1.xml', Buffer.from(xml, 'utf8'));
  let rels = entries.get('ppt/slides/_rels/slide1.xml.rels').toString('utf8');
  rels = rels.replace(/Target="https:\/\/example.com\/"/, 'Target="javascript:alert(1)"');
  entries.set('ppt/slides/_rels/slide1.xml.rels', Buffer.from(rels, 'utf8'));
  const w = memoryWriter();
  await convert(writeZip(entries, deflateRawSync), { write: w.write });
  const html = w.files.get('index.html').toString('utf8');
  const slides = slidesOf(html).map((s) => s.svg).join('');
  // 危险的形式：作为属性出现的事件处理器、javascript: 链接、未转义的标签（作为普通文字显示是安全的）
  assert.ok(!/\son\w+\s*=\s*["']/i.test(slides), '出现了事件处理属性');
  assert.ok(!/javascript:/i.test(slides), '出现了 javascript: 链接');
  assert.ok(!/<img|<script/i.test(slides), '文字没有转义');
});

function readZip(buf, inflate) {
  const out = new Map();
  let eocd = buf.length - 22;
  while (buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nl).toString('utf8');
    const ds = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const data = buf.subarray(ds, ds + csize);
    out.set(name, method === 8 ? inflate(data) : Buffer.from(data));
    p += 46 + nl + el + cl;
  }
  return out;
}

function writeZip(entries, deflate) {
  const parts = [], central = [];
  let off = 0;
  for (const [name, data] of entries) {
    const nb = Buffer.from(name, 'utf8'), comp = deflate(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8);
    h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nb.length, 26);
    parts.push(h, nb, comp);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(off, 42);
    central.push(c, nb);
    off += 30 + nb.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(entries.size, 8); e.writeUInt16LE(entries.size, 10);
  e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat([...parts, cd, e]));
}
