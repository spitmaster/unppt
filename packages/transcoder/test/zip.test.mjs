// zip 读取：条目的本地文件头坏了时读它要报错（以前一直等着，没人处理的失败让 Node 结束进程）；别的条目照常读（源码用 esbuild 现场打包后测试）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const r = await build({ stdin: { contents: `export { ZipReader } from './packages/transcoder/src/io/zip.ts'; export { toSource } from './packages/transcoder/src/io/source.ts';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], logLevel: 'silent' });
const { ZipReader, toSource } = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));

/** 不压缩的 zip（CRC 写 0，读取时不校验） */
function zip(files) {
  const enc = new TextEncoder(), parts = [], cd = [];
  let off = 0;
  for (const [name, text] of files) {
    const n = enc.encode(name), d = enc.encode(text);
    const h = new Uint8Array(30 + n.length), v = new DataView(h.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint32(18, d.length, true); v.setUint32(22, d.length, true); v.setUint16(26, n.length, true);
    h.set(n, 30);
    const c = new Uint8Array(46 + n.length), w = new DataView(c.buffer);
    w.setUint32(0, 0x02014b50, true); w.setUint16(4, 20, true); w.setUint16(6, 20, true); w.setUint32(20, d.length, true); w.setUint32(24, d.length, true); w.setUint16(28, n.length, true); w.setUint32(42, off, true);
    c.set(n, 46);
    parts.push(h, d); cd.push(c); off += h.length + d.length;
  }
  const cdSize = cd.reduce((a, c) => a + c.length, 0);
  const e = new Uint8Array(22), x = new DataView(e.buffer);
  x.setUint32(0, 0x06054b50, true); x.setUint16(8, files.length, true); x.setUint16(10, files.length, true); x.setUint32(12, cdSize, true); x.setUint32(16, off, true);
  const all = [...parts, ...cd, e], out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
  let o = 0; for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}

test('本地文件头坏了的条目：读它报错，不卡住；别的条目照常读', async () => {
  const b = zip([['a.xml', '<a/>'], ['b.xml', '<b/>']]);
  // 第二个条目的本地文件头签名改坏
  const second = 30 + 5 + 4;
  b[second] = 0x00;
  const z = await ZipReader.open(toSource(b));
  assert.equal(new TextDecoder().decode(await z.read('a.xml')), '<a/>');
  await assert.rejects(Promise.race([z.read('b.xml'), new Promise((_, no) => setTimeout(() => no(new Error('卡住了')), 3000))]), /header/i);
});
