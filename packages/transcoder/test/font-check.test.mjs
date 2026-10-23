// 字体检查（unppt check）：嵌入的字体、符号字体没嵌入、没有字体时的结论（不带默认字体包，用例都在仓库里；用构建好的 dist）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkFonts } from '../dist/index.js';

const check = async (name) => checkFonts(new Uint8Array(await readFile(`testcases/${name}.pptx`)));

test('PPT 里嵌入的字体：embedded，没有问题', async () => {
  const c = await check('text-embedded-fonts');
  assert.equal(c.slides, 1);
  assert.ok(c.fonts.length > 0);
  for (const f of c.fonts) assert.equal(f.status, 'embedded', f.font);
  assert.equal(c.errors, 0);
});

test('符号字体没嵌入是必须处理的问题；没有任何字体时是 missing', async () => {
  const c = await check('text-buchar-multi');
  const wd = c.fonts.find((f) => f.font === 'Wingdings');
  assert.equal(wd?.status, 'symbol-missing');
  assert.deepEqual(wd.pages, [1]);
  assert.ok(c.fonts.some((f) => f.status === 'missing'));
  assert.ok(c.errors >= 1);
});

test('"插入符号"的字体（名字不在符号字体名单里的也算）没嵌入：symbol-missing，只用在空格上不算', async () => {
  const { build } = await import('esbuild');
  const r = await build({ stdin: { contents: `export { FontCheckLog } from './packages/transcoder/src/font/check.ts';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent' });
  const { FontCheckLog } = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
  const log = new FontCheckLog(() => false);
  log.record({ requested: 'Euclid Symbol', picked: 'Euclid Symbol', cp: 0xf061, symbol: true }, 1);
  log.record({ requested: 'Space Icons', picked: 'Space Icons', cp: 0x20, symbol: true }, 1);
  log.record({ requested: 'Arial', picked: 'Arial', cp: 0x41 }, 2);
  const c = log.result();
  assert.deepEqual(c.fonts.map((f) => [f.font, f.status]), [['Arial', 'missing'], ['Euclid Symbol', 'symbol-missing']]);
  assert.equal(c.errors, 2);
});
