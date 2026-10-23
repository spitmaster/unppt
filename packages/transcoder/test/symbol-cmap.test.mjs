// 符号字体子集化前把 (3, 0) 符号 cmap 换成 Unicode cmap（font/symbol-cmap.ts）：页面里的原文（'l'、U+F06C、• 等）都要查得到字形
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const r = await build({
  stdin: { contents: `export { withUnicodeCmap } from './packages/transcoder/src/font/symbol-cmap.ts'; export { buildCmap } from './packages/transcoder/src/font/cmap.ts'; export { readSfnt } from './packages/transcoder/src/font/sfnt.ts';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent',
});
const m = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));

const u16 = (v) => [(v >> 8) & 255, v & 255];
const u32 = (v) => [...u16(Math.floor(v / 0x10000)), ...u16(v & 0xffff)];

/** 只有一张 format 4 子表的 cmap：一段 start~end 映射到 first 起的字形 */
function cmap(platform, encoding, start, end, first) {
  const sub = [...u16(4), ...u16(32), ...u16(0), ...u16(4), ...u16(4), ...u16(1), ...u16(0),
    ...u16(end), ...u16(0xffff), ...u16(0), ...u16(start), ...u16(0xffff), ...u16((first - start) & 0xffff), ...u16(1), ...u16(0), ...u16(0)];
  return [...u16(0), ...u16(1), ...u16(platform), ...u16(encoding), ...u32(12), ...sub];
}

/** 只有 cmap、head 两张表的字体文件（够这里用） */
function font(cmapBytes) {
  const tables = [['cmap', cmapBytes], ['head', new Array(54).fill(0)]];
  const out = [...u32(0x00010000), ...u16(tables.length), ...u16(32), ...u16(1), ...u16(0)];
  let off = 12 + tables.length * 16;
  for (const [tag, d] of tables) {
    out.push(...[...tag].map((c) => c.charCodeAt(0)), ...u32(0), ...u32(off), ...u32(d.length));
    off += Math.ceil(d.length / 4) * 4;
  }
  for (const [, d] of tables) { out.push(...d); while (out.length % 4) out.push(0); }
  return new Uint8Array(out);
}

test('只有符号 cmap 的字体：用到的字按符号字体的规则写进 Unicode cmap', () => {
  // U+F020~F0FF -> 字形 3 起
  const bytes = font(cmap(3, 0, 0xf020, 0xf0ff, 3));
  const out = m.withUnicodeCmap(bytes, 0, [0x6c, 0xf06c, 0x2022, 0x4e2d]);
  assert.ok(out, '符号字体要换 cmap');
  const look = m.buildCmap(m.readSfnt(out).get('cmap'));
  assert.equal(look(0x6c), 0x6c - 0x20 + 3, "'l' 是 0xF06C 的字形");
  assert.equal(look(0xf06c), 0x6c - 0x20 + 3, '"插入符号"存的 U+F06C 本身');
  assert.equal(look(0x2022), 0x95 - 0x20 + 3, '• 按 cp1252 换成 0x95');
  assert.equal(look(0x4e2d), 0, '字体里没有的字不写');
  assert.equal(look(0x41), 0, '没用到的字不写');
});

test('有 Unicode cmap 的字体照原样子集化', () => {
  assert.equal(m.withUnicodeCmap(font(cmap(3, 1, 0x20, 0x7e, 3)), 0, [0x41]), undefined);
});
