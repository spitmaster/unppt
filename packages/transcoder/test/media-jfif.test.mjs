// .jfif 扩展名的图片就是 JPEG：照常输出（以前当成不支持的格式丢了）。用合成用例 pictures-exif.pptx 现场把图片改名成 .jfif
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { convert } from '../dist/index.js';

const r = await build({ stdin: { contents: `export { ZipReader } from './packages/transcoder/src/io/zip.ts'; export { toSource } from './packages/transcoder/src/io/source.ts';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], logLevel: 'silent' });
const { ZipReader, toSource } = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));

/** 不压缩的 zip（CRC 写 0，转码器读的时候不校验） */
function zip(files) {
  const enc = new TextEncoder(), parts = [], cd = [];
  let off = 0;
  for (const [name, d] of files) {
    const n = enc.encode(name);
    const h = new Uint8Array(30 + n.length), v = new DataView(h.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint32(18, d.length, true); v.setUint32(22, d.length, true); v.setUint16(26, n.length, true);
    h.set(n, 30);
    const c = new Uint8Array(46 + n.length), w = new DataView(c.buffer);
    w.setUint32(0, 0x02014b50, true); w.setUint16(4, 20, true); w.setUint16(6, 20, true); w.setUint32(20, d.length, true); w.setUint32(24, d.length, true); w.setUint16(28, n.length, true); w.setUint32(42, off, true);
    c.set(n, 46);
    parts.push(h, d); cd.push(c); off += h.length + d.length;
  }
  const size = cd.reduce((a, c) => a + c.length, 0);
  const e = new Uint8Array(22), x = new DataView(e.buffer);
  x.setUint32(0, 0x06054b50, true); x.setUint16(8, files.length, true); x.setUint16(10, files.length, true); x.setUint32(12, size, true); x.setUint32(16, off, true);
  const all = [...parts, ...cd, e], out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
  let o = 0; for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}

test('.jfif 图片照常输出（文件名改成 .jpg），没有"不支持的图片格式"', async () => {
  const src = await ZipReader.open(toSource(new Uint8Array(await readFile('testcases/pictures-exif.pptx'))));
  const jpeg = src.names().find((n) => /^ppt\/media\/.*\.jpe?g$/i.test(n));
  assert.ok(jpeg, '用例里要有 JPEG');
  const base = jpeg.split('/').pop(), renamed = base.replace(/\.jpe?g$/i, '.jfif');
  const files = [];
  for (const n of src.names()) {
    let d = await src.read(n);
    if (n.endsWith('.rels') || n === '[Content_Types].xml') d = new TextEncoder().encode(new TextDecoder().decode(d).split(base).join(renamed));
    files.push([n === jpeg ? n.replace(base, renamed) : n, d]);
  }
  const out = new Map();
  const res = await convert(zip(files), { write: async (p, d) => { out.set(p, d); }, output: 'paged', images: false });
  assert.ok(!res.report.warnings.some((w) => w.includes('jfif') || w.includes('图片无法显示')), res.report.warnings.join('；'));
  assert.ok([...out.keys()].some((p) => /^media\/.*\.jpg$/.test(p)));
});
