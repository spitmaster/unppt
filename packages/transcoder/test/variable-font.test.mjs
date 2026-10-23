// 可变字体（SPEC 第 7 节）：常规用 Regular 实例（wght 400）、粗体用 Bold 实例（700），不用默认实例；同名同字重的固定字重字体
// （默认字体包里的思源黑体）优先；嵌入产物的子集不带可变数据。夹具是 Windows 自带的 Noto Sans SC 可变字体（OFL）里的几个字
// （默认实例是 Thin，字宽：n 0.580 / 0 0.521；Regular 0.610 / 0.555；Bold 0.641 / 0.590，和字体包里的固定字重字体一致）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const r = await build({
  stdin: { contents: `export { loadFontFile } from './packages/transcoder/src/font/font.ts'; export { FontLibrary } from './packages/transcoder/src/font/library.ts'; export { subsetFont } from './packages/transcoder/src/font/subset.ts'; export { packFaces } from './packages/transcoder/src/font/pack.ts'; export { eotToTtf } from './packages/transcoder/src/font/eot.ts'; export { ZipReader } from './packages/transcoder/src/io/zip.ts'; export { toSource } from './packages/transcoder/src/io/source.ts';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], loader: { '.wasm': 'binary' }, logLevel: 'silent',
});
const m = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
const vfBytes = new Uint8Array(await readFile('packages/transcoder/test/fonts/NotoSansSC-VF-subset.ttf'));
const N = 'n'.codePointAt(0), ZERO = '0'.codePointAt(0);
const round = (v) => Math.round(v * 1000) / 1000;

/** WOFF 里的表名 */
function woffTags(b) {
  const n = (b[12] << 8) | b[13];
  return Array.from({ length: n }, (_, i) => String.fromCharCode(...b.subarray(44 + i * 20, 48 + i * 20)));
}

test('可变字体读出轴；默认实例是 Thin，不能直接用', async () => {
  const [vf] = await m.loadFontFile(vfBytes);
  assert.deepEqual(vf.axes, [{ tag: 'wght', min: 100, def: 100, max: 900 }]);
  assert.equal(vf.weight, 100);
  assert.equal(round((await vf.load()).advance(N)), 0.58);
});

test('只有可变字体时：常规取 Regular 实例、粗体取 Bold 实例（字宽、字重都是实例的），同一个实例只做一次', async () => {
  const lib = new m.FontLibrary();
  lib.add(await m.loadFontFile(vfBytes));
  const reg = lib.find('Noto Sans SC', false, false), bold = lib.find('Noto Sans SC', true, false);
  assert.equal(reg.axes, undefined);
  assert.equal(reg.weight, 400);
  assert.equal(reg.bold, false);
  assert.equal(bold.weight, 700);
  assert.equal(bold.bold, true);
  const rm = await reg.load(), bm = await bold.load();
  assert.equal(round(rm.advance(N)), 0.61);
  assert.equal(round(rm.advance(ZERO)), 0.555);
  assert.equal(round(bm.advance(N)), 0.641);
  assert.equal(round(bm.advance(ZERO)), 0.59);
  assert.equal(lib.find('Noto Sans SC', false, false), reg);
  const [inst] = await m.loadFontFile(await reg.source.read(0, reg.source.size));
  assert.equal(inst.axes, undefined, '实例的字体数据里没有 fvar');
  assert.equal(inst.weight, 400);
});

test('同名同字重的固定字重字体（任何优先级）优先于取实例；只有度量的原字体不算', async () => {
  const [vf] = await m.loadFontFile(vfBytes);
  const fixed = (weight, o = {}) => ({ families: ['noto sans sc'], displayFamily: 'Noto Sans SC', bold: weight >= 600, italic: false, weight, offset: 0, source: {}, rank: 2, load: async () => ({}), ...o });
  const regular = fixed(400), metricsOnly = fixed(700, { metricsOnly: true });
  const lib = new m.FontLibrary();
  lib.add([vf, regular, metricsOnly]);
  assert.equal(lib.find('Noto Sans SC', false, false), regular, '字体包里的 Regular 压过本机可变字体的实例');
  const b = lib.find('Noto Sans SC', true, false);
  assert.notEqual(b, metricsOnly);
  assert.equal(b.weight, 700);
  assert.equal(b.axes, undefined);
});

test('嵌入产物的子集不带可变数据：实例的子集、漏网的可变字体（固定在默认实例）都没有 fvar / gvar / HVAR', async () => {
  const lib = new m.FontLibrary();
  lib.add(await m.loadFontFile(vfBytes));
  const reg = lib.find('Noto Sans SC', false, false);
  await reg.load();
  const vf = (await m.loadFontFile(vfBytes))[0];
  for (const f of [reg, vf]) {
    const tags = woffTags(await m.subsetFont(f.source, f.offset, [N, ZERO], 'x'));
    assert.ok(tags.includes('glyf') && tags.includes('cmap'));
    for (const t of ['fvar', 'gvar', 'HVAR', 'avar']) assert.ok(!tags.includes(t), `子集里有 ${t}`);
  }
});

test('字体包：对照规则里的所有开源字体都能直接用（没有原字体对到的粗体也是）；有字体文件的家族不再用度量包里的同名原字体', async () => {
  const zip = await m.ZipReader.open(m.toSource(new Uint8Array(await readFile('testcases/text-embedded-fonts.pptx'))));
  const ttf = m.eotToTtf(await zip.read(zip.names().find((n) => /^ppt\/fonts\/.*\.fntdata$/.test(n))));
  const own = (await m.loadFontFile(ttf))[0].families;
  const info = (id, families) => ({ id, families, display: families[0], bold: false, italic: false, weight: 400, upem: 1000, ascent: 1000, descent: 200, lineGap: 0, cjk: false });
  const pack = {
    faces: [info('0', ['原字体甲']), info('1', [own[0]])],
    rules: [{ show: { regular: 'r.ttf', bold: 'b.ttf' } }],
    metrics: async () => ({ runs: [[0x41, 3, 600]], kern: [] }),
    file: (n) => (n === 'r.ttf' || n === 'b.ttf' ? ttf : undefined),
  };
  const faces = await m.packFaces(pack);
  assert.equal(faces.filter((f) => !f.metricsOnly).length, 2, '常规、粗体两个文件都打开了（以前粗体没有原字体用到就不打开）');
  assert.ok(faces.some((f) => f.metricsOnly && f.families.includes('原字体甲')));
  assert.ok(!faces.some((f) => f.metricsOnly && f.families.includes(own[0])), '度量包里和开源字体同名的原字体不用');
});
