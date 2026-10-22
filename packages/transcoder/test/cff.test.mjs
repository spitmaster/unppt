// CFF 字形轮廓（.otf）：坏数据不能卡死、不能吃光内存（字体可能来自不受信任的文件）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const r = await build({
  stdin: { contents: `export { CffOutlines } from './packages/transcoder/src/font/cff.ts'; export { toSource } from './packages/transcoder/src/io/source.ts';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], logLevel: 'silent',
});
const m = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));

/** 只有一项的 INDEX（offSize 1） */
const index1 = (data) => [0, 1, 1, 1, data.length + 1, ...data];
/** 最小的 CFF 表：头、空的名字 INDEX、顶层 DICT INDEX、空的字符串 INDEX、全局子程序 INDEX，后面接 extra */
const cff = (top, gsubrs = [], extra = []) =>
  [1, 0, 4, 1, 0, 0, ...index1(top), 0, 0, ...(gsubrs.length ? index1(gsubrs) : [0, 0]), ...extra];
const outlines = (bytes) => new m.CffOutlines(m.toSource(new Uint8Array(bytes)), { offset: 0, length: bytes.length }, 1000);

test('顶层 DICT 里没写结束半字节的实数：读到 DICT 末尾为止，不卡死', async () => {
  assert.deepEqual(await outlines(cff([30, 0x12, 0x34])).glyph(0), []);
});

test('子程序反复调用自己（10 层嵌套、每层 20 次）：执行到上限就停，不卡死', async () => {
  // 全局子程序 0：push -107（bias 107 后是 0 号）+ callgsubr，重复 20 次，再 return
  const gsubr = [...Array.from({ length: 20 }, () => [32, 29]).flat(), 11];
  const charstring = [32, 29, 14]; // 调用 0 号全局子程序，endchar
  // 顶层 DICT 写 CharStrings（操作符 17）的偏移；偏移用 3 字节的 28 编码，长度固定，先算出表头长度
  const csOff = cff([28, 0, 0, 17], gsubr).length;
  const bytes = cff([28, csOff >> 8, csOff & 255, 17], gsubr, index1(charstring));
  const t0 = Date.now();
  await outlines(bytes).glyph(0);
  assert.ok(Date.now() - t0 < 5000, '应该很快结束');
});
