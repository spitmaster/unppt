// cmap 解析：Unicode 子表照常查；只有 (3, 0) 子表的符号字体，0x20~0xFF 映射到 U+F000 + 字符（源码用 esbuild 现场打包后测试）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const r = await build({ entryPoints: ['packages/transcoder/src/font/cmap.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent' });
const { buildCmap } = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));

/** 一个只有一个子表（platform, encoding）的 cmap：一段 start~end，字形 = 码点 + delta，再加结尾段 0xFFFF */
function cmap(platform, encoding, start, end, delta) {
  const segs = [[start, end, delta], [0xffff, 0xffff, 1]];
  const segX2 = segs.length * 2;
  const len = 14 + segX2 * 4 + 2;
  const b = new DataView(new ArrayBuffer(12 + len));
  b.setUint16(2, 1);
  b.setUint16(4, platform); b.setUint16(6, encoding); b.setUint32(8, 12);
  const o = 12;
  b.setUint16(o, 4); b.setUint16(o + 2, len); b.setUint16(o + 6, segX2);
  segs.forEach(([s, e, d], i) => {
    b.setUint16(o + 14 + i * 2, e);
    b.setUint16(o + 14 + segX2 + 2 + i * 2, s);
    b.setUint16(o + 14 + segX2 * 2 + 2 + i * 2, d & 0xffff);
  });
  return new Uint8Array(b.buffer);
}

test('Unicode 子表按码点查', () => {
  const look = buildCmap(cmap(3, 1, 0x41, 0x5a, -0x40));
  assert.equal(look(0x41), 1);
  assert.equal(look(0x5a), 26);
  assert.equal(look(0x61), 0);
});

test('符号字体：ASCII 映射到 U+F0xx，U+F0xx 本身也能查到', () => {
  const look = buildCmap(cmap(3, 0, 0xf020, 0xf0ff, -0xf000));
  assert.equal(look(0x61), 0x61);
  assert.equal(look(0xd8), 0xd8);
  assert.equal(look(0xf0fc), 0xfc);
  assert.equal(look(0x4e00), 0);
});
