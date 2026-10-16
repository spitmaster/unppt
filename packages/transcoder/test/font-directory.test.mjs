// 嵌入字体的表目录没按规范排序（倒序）时：读入后重排，子集化能成功（源码用 esbuild 现场打包后测试；字体取自合成用例）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const r = await build({
  stdin: { contents: `export { eotToTtf, loadEmbeddedFont } from './packages/transcoder/src/font/eot.ts'; export { subsetFont } from './packages/transcoder/src/font/subset.ts'; export { sortTableDirectory } from './packages/transcoder/src/font/sfnt.ts'; export { ZipReader } from './packages/transcoder/src/io/zip.ts'; export { toSource } from './packages/transcoder/src/io/source.ts';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], loader: { '.wasm': 'binary' }, logLevel: 'silent',
});
const m = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));

/** 把表目录改成倒序（PowerPoint 嵌入的一些 CFF 字体就是这样） */
function reversed(b) {
  const out = b.slice(), n = (b[4] << 8) | b[5];
  for (let i = 0; i < n; i++) out.set(b.subarray(12 + (n - 1 - i) * 16, 28 + (n - 1 - i) * 16), 12 + i * 16);
  return out;
}
const tags = (b) => Array.from({ length: (b[4] << 8) | b[5] }, (_, i) => String.fromCharCode(...b.subarray(12 + i * 16, 16 + i * 16)));

test('倒序的表目录：子集化失败；读入时重排后能子集化，表数据不变', async () => {
  const zip = await m.ZipReader.open(m.toSource(new Uint8Array(await readFile('testcases/text-embedded-fonts.pptx'))));
  const name = zip.names().find((n) => /^ppt\/fonts\/.*\.fntdata$/.test(n));
  const ttf = m.eotToTtf(await zip.read(name));
  const bad = reversed(ttf);
  assert.notDeepEqual(tags(bad), [...tags(bad)].sort());
  assert.equal(await m.subsetFont(m.toSource(bad), 0, [0x41], 'x'), undefined, '倒序时 HarfBuzz 找不到表');
  const fixed = m.sortTableDirectory(bad);
  assert.deepEqual(tags(fixed), [...tags(fixed)].sort());
  assert.deepEqual(fixed.subarray(12 + tags(fixed).length * 16), bad.subarray(12 + tags(bad).length * 16), '表数据不动');
  const [face] = await m.loadEmbeddedFont(bad, 'X', false, false);
  const bytes = await face.source.read(0, face.source.size);
  assert.deepEqual(tags(bytes), [...tags(bytes)].sort(), '读入嵌入字体时已经重排');
  assert.ok(await m.subsetFont(face.source, face.offset, [0x41], 'x'));
  assert.equal(m.sortTableDirectory(ttf), ttf, '本来有序的原样返回');
});
