// PowerPoint 不用的嵌入字体（CFF 轮廓、表目录没排序）按缺字体处理：标成 unusable，字体库不再返回（源码用 esbuild 现场打包后测试；字体取自合成用例）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const r = await build({
  stdin: { contents: `export { eotToTtf, lazyEmbeddedFont } from './packages/transcoder/src/font/eot.ts'; export { FontLibrary } from './packages/transcoder/src/font/font.ts'; export { ZipReader } from './packages/transcoder/src/io/zip.ts'; export { toSource } from './packages/transcoder/src/io/source.ts';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], loader: { '.wasm': 'binary' }, logLevel: 'silent',
});
const m = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));

const zip = await m.ZipReader.open(m.toSource(new Uint8Array(await readFile('testcases/text-embedded-fonts.pptx'))));
const eot = await zip.read(zip.names().find((n) => /^ppt\/fonts\/.*\.fntdata$/.test(n)));
const ttf = m.eotToTtf(eot);
/** 把表目录改成倒序 */
function reversed(b) {
  const out = b.slice(), n = (b[4] << 8) | b[5];
  for (let i = 0; i < n; i++) out.set(b.subarray(12 + (n - 1 - i) * 16, 28 + (n - 1 - i) * 16), 12 + i * 16);
  return out;
}

async function face(bytes) {
  const reasons = [];
  const f = m.lazyEmbeddedFont(async () => bytes, 'TestFace', false, false, (why) => reasons.push(why ?? '读不出来'));
  const lib = new m.FontLibrary();
  lib.add([f]);
  assert.equal(lib.find('TestFace', false, false), f, '读出来之前先按登记的名字找到');
  const metrics = await f.load();
  return { f, lib, reasons, metrics };
}

test('目录正常的 TrueType 照常用', async () => {
  const { f, lib, reasons } = await face(eot);
  assert.equal(f.unusable, undefined);
  assert.deepEqual(reasons, []);
  assert.equal(lib.find('TestFace', false, false), f);
});

test('表目录倒序的、CFF 轮廓的：标成用不了，记原因，字体库不再返回', async () => {
  const cff = new Uint8Array(64); cff.set([0x4f, 0x54, 0x54, 0x4f, 0, 1]);
  for (const [bytes, why] of [[reversed(ttf), '表目录'], [cff, 'CFF']]) {
    const { f, lib, reasons } = await face(bytes);
    assert.equal(f.unusable, true, why);
    assert.ok(reasons[0].includes(why), why);
    assert.equal(lib.find('TestFace', false, false), undefined, why);
    assert.equal(lib.has('TestFace'), false, why);
  }
});
