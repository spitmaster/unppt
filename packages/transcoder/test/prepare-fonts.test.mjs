// 出图准备的字体（preview/prepare.ts）：交给 resvg 哪些字体文件、什么顺序、每段文字写哪个字体，画不了的私用区字怎么办
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { libjpegTurbo } from '../../../scripts/esbuild-libjpeg.mjs';

const r = await build({ entryPoints: ['packages/transcoder/src/preview/prepare.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], loader: { '.wasm': 'binary' }, plugins: [libjpegTurbo], logLevel: 'silent' });
const { Preparer } = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));

const pua = (cp) => cp >= 0xe000 && cp <= 0xf8ff;
const file = (name, family) => ({ name, family, size: 0, read: async () => new Uint8Array() });
const sans = file('NotoSansSC-Regular', 'Noto Sans SC'), sansBold = file('NotoSansSC-Bold', 'Noto Sans SC');
const lib = file('LiberationSans-Regular', 'Liberation Sans'), compat = file('UnpptWingdingsCompat', 'Unppt Wingdings Compat');
/** 默认字体包里的原字体：显示用 source 那个开源字体文件，能画 cover 为真的字 */
const face = (displayFamily, source, cover, o = {}) => ({
  families: [displayFamily.toLowerCase()], displayFamily, shownFamily: source.family, source, offset: 0, bold: false, italic: false, weight: 400, rank: 2,
  load: async () => ({ advance: (cp) => (cover(cp) ? 0.5 : undefined) }), ...o,
});
const cjk = (cp) => !pua(cp), latin = (cp) => cp < 0x3000 && !pua(cp), wing = (cp) => (cp >= 0x20 && cp <= 0xff) || (cp >= 0xf020 && cp <= 0xf0ff);
const faces = {
  'microsoft yahei': face('Microsoft YaHei', sans, cjk), 'microsoft yahei/b': face('Microsoft YaHei', sansBold, cjk, { bold: true, weight: 700 }),
  '等线': face('DengXian', sans, cjk), '等线/b': face('DengXian', sansBold, cjk, { bold: true, weight: 700 }),
  dengxian: face('DengXian', sans, cjk), 'dengxian/b': face('DengXian', sansBold, cjk, { bold: true, weight: 700 }),
  calibri: face('Calibri', lib, latin), wingdings: face('Wingdings', compat, wing),
};
const resolve = (n, bold) => faces[n.toLowerCase() + (bold ? '/b' : '')] ?? (bold ? undefined : faces[n.toLowerCase()]);
const size = { picWidth: 1280, thumbWidth: 128, thumbHeight: 72 };
const page = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">${body}</svg>`;
const files = (prep, main) => main.fonts.map((id) => [...prep['faces']].find(([k]) => k === id)[1].source.name);
const BOX = String.fromCodePoint(0x25a1);

test('每段文字写列表里第一个能画全它的字体；找得到的都交给 resvg，常规体在前，同一个文件只给一份', async () => {
  const prep = new Preparer(resolve, async () => undefined);
  const { main } = await prep.job(1, page(`<text font-weight="bold" font-family="'Microsoft YaHei',sans-serif">标题</text>`
    + `<text font-family="'Calibri','等线',sans-serif">Q1</text><text font-family="'Calibri','等线',sans-serif">1月</text>`), size);
  assert.ok(main.svg.includes(`font-weight="bold" font-family="Noto Sans SC">标题`));
  assert.ok(main.svg.includes(`font-family="Liberation Sans">Q1`), 'Calibri 能画全的用 Calibri');
  assert.ok(main.svg.includes(`font-family="Noto Sans SC">1月`), 'Calibri 画不了"月"，整段用等线（resvg 不按列表逐字找）');
  assert.deepEqual(files(prep, main), ['NotoSansSC-Regular', 'LiberationSans-Regular', 'NotoSansSC-Bold']);
  assert.equal(main.defaultFamily, 'Noto Sans SC');
});

test('粗体的中西文标签选到粗体字形（不靠 resvg 不看字重的替代）', async () => {
  const prep = new Preparer(resolve, async () => undefined);
  const { main } = await prep.job(1, page(`<text font-family="'等线',sans-serif">正文</text><text font-weight="bold" font-family="'Calibri','等线',sans-serif">1月</text>`), size);
  assert.ok(main.svg.includes(`font-weight="bold" font-family="Noto Sans SC">1月`));
  assert.ok(files(prep, main).includes('NotoSansSC-Bold'));
});

test('符号字体（Wingdings 兼容字体）排在最后、不当默认字体', async () => {
  const prep = new Preparer(resolve, async () => undefined);
  const { main } = await prep.job(1, page(`<text font-family="'Wingdings',sans-serif">l</text><text font-family="'Calibri',sans-serif">Text</text>`), size);
  assert.deepEqual(files(prep, main), ['LiberationSans-Regular', 'UnpptWingdingsCompat']);
  assert.equal(main.defaultFamily, 'Liberation Sans');
});

test('选定的字体画不了的私用区字画成方框，不借用 Wingdings 兼容字体画成别的符号；兼容字体自己的照画', async () => {
  const sym = String.fromCodePoint(0xf061, 0xf034), bullet = String.fromCodePoint(0xf0b7), wl = String.fromCodePoint(0xf06c);
  const prep = new Preparer(resolve, async () => undefined);
  const { main } = await prep.job(1, page(`<text font-family="'Webdings',sans-serif">${sym}a</text>`
    + `<text font-family="'Calibri',sans-serif">${bullet}</text><text font-family="'Wingdings',sans-serif">${wl}</text>`
    + `<text font-family="'Calibri',sans-serif">&#xF0B7;x</text>`), size);
  assert.ok(main.svg.includes(`font-family="'Webdings',sans-serif">${BOX}${BOX}a<`), '没嵌入的 Webdings');
  assert.ok(main.svg.includes(`font-family="Liberation Sans">${BOX}<`), 'Calibri 里的私用区字（Symbol 项目符号）');
  assert.ok(main.svg.includes(`font-family="Unppt Wingdings Compat">${wl}<`), 'Wingdings 兼容字体能画的不换');
  assert.ok(main.svg.includes(`font-family="Liberation Sans">${BOX}x<`), '写成转义的也换');
});
