// 默认字体包（SPEC D3）：按 map.json 给原字体挑开源显示字体；原字体的字宽、字距来自度量包，字形来源指向开源字体
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const r = await build({
  stdin: { contents: `export { displayFile, packFaces } from './packages/transcoder/src/font/pack.ts'; export { FontLibrary } from './packages/transcoder/src/font/font.ts'; export { eotToTtf } from './packages/transcoder/src/font/eot.ts'; export { ZipReader } from './packages/transcoder/src/io/zip.ts'; export { toSource } from './packages/transcoder/src/io/source.ts';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], loader: { '.wasm': 'binary' }, logLevel: 'silent',
});
const m = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
const rules = JSON.parse(await readFile('packages/fonts/map.json', 'utf8')).rules;
const face = (families, o = {}) => ({ families, bold: false, italic: false, weight: 400, cjk: false, generic: undefined, ...o });

test('对照规则：中文按字体名分黑体、宋体、楷体、仿宋，西文按名字和大类', () => {
  assert.equal(m.displayFile(face(['microsoft yahei', '微软雅黑'], { cjk: true }), rules), 'NotoSansSC-Regular.otf');
  assert.equal(m.displayFile(face(['microsoft yahei'], { cjk: true, bold: true, weight: 700 }), rules), 'NotoSansSC-Bold.otf');
  assert.equal(m.displayFile(face(['microsoft yahei light'], { cjk: true, weight: 290 }), rules), 'NotoSansSC-Light.otf');
  assert.equal(m.displayFile(face(['simsun', '宋体'], { cjk: true }), rules), 'NotoSerifSC-Regular.otf');
  assert.equal(m.displayFile(face(['kaiti', '楷体'], { cjk: true }), rules), 'LXGWWenKai-Regular.ttf');
  assert.equal(m.displayFile(face(['fangsong', '仿宋'], { cjk: true }), rules), 'ZhuqueFangsong-Regular.ttf');
  assert.equal(m.displayFile(face(['calibri'], { bold: true, italic: true }), rules), 'Carlito-BoldItalic.ttf');
  assert.equal(m.displayFile(face(['times new roman'], { generic: 'roman' }), rules), 'LiberationSerif-Regular.ttf');
  assert.equal(m.displayFile(face(['courier new']), rules), 'LiberationMono-Regular.ttf');
  assert.equal(m.displayFile(face(['segoe ui'], { generic: 'swiss' }), rules), 'LiberationSans-Regular.ttf');
  assert.equal(m.displayFile(face(['wingdings']), rules), undefined, '符号字体没有显示字体');
  assert.equal(m.displayFile(face(['segoe mdl2 assets']), rules), undefined, '图标字体也是');
  assert.equal(m.displayFile(face(['monotype corsiva'], { generic: 'script' }), rules), 'LiberationSans-Regular.ttf', 'Monotype 不是等宽字体');
});

test('原字体的字宽、字距来自度量包，嵌入用的字体来源是开源字体；同名时指定的字体压过字体包', async () => {
  // 显示字体用合成用例里嵌入的字体（仓库里有，不依赖下载的字体文件）
  const zip = await m.ZipReader.open(m.toSource(new Uint8Array(await readFile('testcases/text-embedded-fonts.pptx'))));
  const ttf = m.eotToTtf(await zip.read(zip.names().find((n) => /^ppt\/fonts\/.*\.fntdata$/.test(n))));
  const info = { id: '0', families: ['测试原字体'], display: 'Test Orig', bold: false, italic: false, weight: 400, upem: 1000, ascent: 1050, descent: 250, lineGap: 0, cjk: false };
  const pack = {
    faces: [info], rules: [{ show: { regular: 'x.ttf' } }],
    metrics: async () => ({ runs: [[0x41, 3, 600], [0x4e00, 2, 1000]], kern: [[0x41, 0x56, -80]] }),
    file: (n) => (n === 'x.ttf' ? ttf : undefined),
  };
  const faces = await m.packFaces(pack);
  const orig = faces.find((f) => f.families.includes('测试原字体'));
  const met = await orig.load();
  assert.equal(met.advance(0x41), 0.6);
  assert.equal(met.advance(0x43), 0.6);
  assert.equal(met.advance(0x44), undefined, '度量包里没有的字');
  assert.equal(met.advance(0x4e01), 1);
  assert.equal(met.kern(0x41, 0x56), -0.08);
  assert.equal(met.ascent, 1.05);
  assert.equal(orig.rank, 2);
  assert.equal(orig.source.size, ttf.length, '嵌入、出图用的是开源字体');
  const lib = new m.FontLibrary();
  lib.add(faces);
  const own = { ...orig, rank: undefined, families: ['测试原字体'] };
  lib.add([own]);
  assert.equal(lib.find('测试原字体', false, false), own);
});
