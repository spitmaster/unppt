// 出图准备的字体（preview/prepare.ts）：交给 resvg 哪些字体文件、什么顺序，找不到字体的符号字体字怎么画
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { libjpegTurbo } from '../../../scripts/esbuild-libjpeg.mjs';

const r = await build({ entryPoints: ['packages/transcoder/src/preview/prepare.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], loader: { '.wasm': 'binary' }, plugins: [libjpegTurbo], logLevel: 'silent' });
const { Preparer } = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));

const file = (name) => ({ name, size: 0, read: async () => new Uint8Array() });
const sans = file('NotoSansSC-Regular'), sansBold = file('NotoSansSC-Bold'), lib = file('LiberationSans-Regular');
const face = (displayFamily, source, o = {}) => ({ families: [displayFamily.toLowerCase()], displayFamily, shownFamily: source.name.replace(/-.*/, ''), source, offset: 0, bold: false, italic: false, weight: 400, ...o });
// 默认字体包：雅黑、等线都用思源黑体那个文件
const faces = {
  'microsoft yahei': face('Microsoft YaHei', sans), 'microsoft yahei/b': face('Microsoft YaHei', sansBold, { bold: true, weight: 700 }),
  '等线': face('DengXian', sans), calibri: face('Calibri', lib),
};
const resolve = (n, bold) => faces[n.toLowerCase() + (bold ? '/b' : '')] ?? (bold ? undefined : faces[n.toLowerCase()]);
const size = { picWidth: 1280, thumbWidth: 128, thumbHeight: 72 };

test('字体列表里找得到的字体都交给 resvg，常规体排在粗体前面，同一个文件只给一份', async () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">`
    + `<text font-weight="bold" font-family="'Microsoft YaHei',sans-serif">标题</text>`
    + `<text font-family="'Calibri','等线',sans-serif">1月</text></svg>`;
  const prep = new Preparer(resolve, async () => undefined);
  const { main } = await prep.job(1, svg, size);
  assert.match(main.svg, /font-weight="bold" font-family="NotoSansSC">标题/);
  assert.match(main.svg, /font-family="LiberationSans">1月/);
  const files = await Promise.all(main.fonts.map(async (id) => [...prep['faces']].find(([k]) => k === id)[1].source.name));
  assert.deepEqual(files, ['NotoSansSC-Regular', 'LiberationSans-Regular', 'NotoSansSC-Bold'], '等线（思源黑体）也给了，常规体在前，雅黑常规和等线共用一个文件');
});

test('找不到字体的符号字体（没嵌入的 Webdings 用"插入符号"插的字）画成方框，不借用别的字体里的同一个码点', async () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">`
    + `<text font-family="'Webdings',sans-serif">\uf061\uf034a</text><text font-family="'Wingdings',sans-serif">\uf06c</text></svg>`;
  const { main } = await new Preparer(resolve, async () => undefined).job(1, svg, size);
  assert.match(main.svg, /font-family="'Webdings',sans-serif">\u25a1\u25a1a</);
});
