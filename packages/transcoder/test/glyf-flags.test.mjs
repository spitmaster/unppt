// glyf 点标志保留位 0x80 被清掉，重复计数字节不动（源码用 esbuild 现场打包后测试）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const r = await build({
  stdin: { contents: `export { clearReservedGlyphFlags } from './packages/transcoder/src/font/glyf-flags.ts';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent',
});
const m = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));

test('简单字形的点标志清掉 0x80，重复计数保持原值', () => {
  // 一个轮廓 4 个点：标志 0x81，0x89 + 重复 2（计数字节 0x82 不能改），坐标随意
  const glyph = [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0x81, 0x89, 0x82, 0, 0, 0, 0];
  const glyf = new Uint8Array(glyph.length + 1);
  glyf.set(glyph);
  const head = new Uint8Array(54); // indexToLocFormat = 0（短 loca）
  const loca = new Uint8Array([0, 0, 0, glyf.length / 2]);
  m.clearReservedGlyphFlags(new Map([['head', head], ['loca', loca], ['glyf', glyf]]));
  assert.deepEqual([...glyf.subarray(14, 17)], [0x01, 0x09, 0x82]);
});
