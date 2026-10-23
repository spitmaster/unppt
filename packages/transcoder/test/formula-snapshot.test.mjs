// 公式改用 Fallback 图片时：Fallback 里的元素带上 SNAPSHOT 标记；图片正着铺在转动、翻转后的外接矩形里（连边框）（源码用 esbuild 现场打包后测试）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

async function load(entry) {
  const r = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
  return import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
}
const { parseXml, expandAlternate, SNAPSHOT } = await load('packages/transcoder/src/io/xml.ts');
const { snapshotArea } = await load('packages/transcoder/src/render/elements/snapshot.ts');
const { presetGeometry } = await load('packages/transcoder/src/geometry/geometry.ts');

const NS = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
  + ' xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"';
const alt = (choice, requires = 'a14') => parseXml(`<p:spTree ${NS}><mc:AlternateContent><mc:Choice Requires="${requires}"><p:sp>${choice}</p:sp></mc:Choice>`
  + '<mc:Fallback><p:sp><p:spPr/></p:sp></mc:Fallback></mc:AlternateContent></p:spTree>').children;

test('Choice 里有公式：用 Fallback，元素带 SNAPSHOT 标记', () => {
  const [sp] = expandAlternate(alt('<p:txBody><a:p><a14:m/></a:p></p:txBody>'));
  assert.equal(sp.attrs[SNAPSHOT], '1');
  assert.ok(sp.children.some((c) => c.name === 'p:spPr'));
});

test('Choice 能画：用 Choice，不带标记；Choice 不认识时用 Fallback，也不带标记', () => {
  const [a] = expandAlternate(alt('<p:txBody><a:p/></p:txBody>'));
  assert.equal(a.attrs[SNAPSHOT], undefined);
  assert.ok(a.children.some((c) => c.name === 'p:txBody'));
  const [b] = expandAlternate(alt('<p:txBody><a14:m/></p:txBody>', 'x99'));
  assert.equal(b.attrs[SNAPSHOT], undefined);
});

const rect = presetGeometry('rect');
const box = (o) => ({ x: 100, y: 50, w: 60, h: 40, rot: 0, flipH: false, flipV: false, ...o });
const near = (a, b) => Object.keys(b).forEach((k) => assert.ok(Math.abs(a[k] - b[k]) < 0.01, `${k}: ${a[k]} vs ${b[k]}`));

test('不转不翻、没有边框：不用换（照常拉伸到形状框）', () => {
  assert.equal(snapshotArea(rect, box({}), new Map(), 0), undefined);
});

test('转 270°：外接矩形宽高对调、中心不变；只翻转：就是形状框', () => {
  near(snapshotArea(rect, box({ rot: 270 }), new Map(), 0), { x: 110, y: 40, w: 40, h: 60 });
  near(snapshotArea(rect, box({ flipV: true }), new Map(), 0), { x: 100, y: 50, w: 60, h: 40 });
});

test('有边框：每边外扩半个线宽', () => {
  near(snapshotArea(rect, box({}), new Map(), 4), { x: 98, y: 48, w: 64, h: 44 });
});
