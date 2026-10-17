// 转动后轮廓的外接矩形（不跟着形状转的填充铺在这里）：长方形、切角长方形、翻转（源码用 esbuild 现场打包后测试）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const r = await build({ entryPoints: ['packages/transcoder/src/geometry/turned-bounds.ts'], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { turnedBounds } = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
const geo = await build({ entryPoints: ['packages/transcoder/src/geometry/geometry.ts'], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { presetGeometry } = await import('data:text/javascript;base64,' + Buffer.from(geo.outputFiles[0].text).toString('base64'));

const near = (a, b) => Object.keys(b).forEach((k) => assert.ok(Math.abs(a[k] - b[k]) < 0.01, `${k}: ${a[k]} vs ${b[k]}`));

test('长方形转 90°：宽高对调，中心不变', () => {
  near(turnedBounds(presetGeometry('rect'), 200, 100, new Map(), 90), { x: 50, y: -50, w: 100, h: 200 });
});

test('长方形转 45°：和形状框的外接矩形一样', () => {
  const s = (200 + 100) / Math.SQRT2;
  near(turnedBounds(presetGeometry('rect'), 200, 100, new Map(), 45), { x: 100 - s / 2, y: 50 - s / 2, w: s, h: s });
});

test('右上角切掉的长方形转 45°：最右边是切口，比形状框的外接矩形窄', () => {
  // 切掉 50：切口两端 (150,0)、(200,50) 转 45° 后都在中心右边 150/√2（不切时是 200/√2）
  const b = turnedBounds(presetGeometry('snip1Rect'), 200, 200, new Map([['adj', 'val 25000']]), 45);
  near(b, { x: 100 - 200 / Math.SQRT2, w: 350 / Math.SQRT2, h: 400 / Math.SQRT2 });
});

test('左右翻转后再转：切口到左边', () => {
  const b = turnedBounds(presetGeometry('snip1Rect'), 200, 200, new Map([['adj', 'val 25000']]), -45, true);
  near(b, { x: 100 - 150 / Math.SQRT2, w: 350 / Math.SQRT2 });
});
