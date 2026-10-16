// 嵌入字体的 CTF 还原：组合字形带"有指令"标志、却没写两个指令计数（样本里的字体这样存，PowerPoint 能用）时不能错位
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

async function load(entry) {
  const r = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], logLevel: 'silent' });
  return import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
}
const { ctfToTtf } = await load('packages/transcoder/src/font/ctf.ts');
const { readSfnt, writeSfnt, finishTables } = await load('packages/transcoder/src/font/sfnt.ts');

const u16 = (v) => [(v >> 8) & 255, v & 255];
/** 简单字形：1 个轮廓、3 个点 (0,10) (10,10) (10,0)，没有指令（两个计数都是 0） */
const simple = [...u16(1), 2, 1, 11, 0, 10, 10, 10, 0, 0];
/** 组合字形：一个部件（字形 0），参数是字，最后一个部件带"有指令"标志 0x100 */
const composite = (counts) => [...u16(0xffff), ...u16(0), ...u16(0), ...u16(10), ...u16(10), ...u16(0x0107), ...u16(0), 0, 0, 0, 0, ...(counts ? [3, 2] : [])];

function ctf(glyphs) {
  const maxp = new Uint8Array(32);
  maxp.set([0, 1, 0, 0, ...u16(glyphs.length), ...u16(3), ...u16(1), ...u16(3), ...u16(1)]);
  maxp.set(u16(1), 28);
  return writeSfnt(finishTables([['head', new Uint8Array(54)], ['maxp', maxp], ['glyf', new Uint8Array(glyphs.flat())]]));
}

function contoursOf(ttf) {
  const t = readSfnt(ttf);
  const loca = t.get('loca'), glyf = t.get('glyf');
  const at = (g) => (loca[g * 4] << 24 | loca[g * 4 + 1] << 16 | loca[g * 4 + 2] << 8 | loca[g * 4 + 3]) >>> 0;
  return Array.from({ length: loca.length / 4 - 1 }, (_, g) => { const v = (glyf[at(g)] << 8) | glyf[at(g) + 1]; return v & 0x8000 ? v - 0x10000 : v; });
}

test('照规范写了计数的照常还原', () => {
  assert.deepEqual(contoursOf(ctfToTtf(ctf([simple, composite(true), simple]))), [1, -1, 1]);
});

test('组合字形带指令标志却没写计数：回头当成没写再读，后面的字形不错位', () => {
  assert.deepEqual(contoursOf(ctfToTtf(ctf([simple, composite(false), simple, composite(true), simple]))), [1, -1, 1, -1, 1]);
});

test('真读不下去的照样报错', () => {
  assert.throws(() => ctfToTtf(ctf([simple, simple.slice(0, 5)])));
});
