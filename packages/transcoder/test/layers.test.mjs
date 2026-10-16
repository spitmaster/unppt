// 出图的背景层缓存：页面切成背景段和本页内容、缓存键、叠加、按字节数淘汰（源码用 esbuild 现场打包后测试）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const r = await build({ entryPoints: ['packages/transcoder/src/preview/layers.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent' });
const { splitTemplate, composite, TemplateCache } = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));

const open = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="960" height="540">';
const page = (n, defs, ...kids) => `${open}${defs.replace(/U/g, `u${n}_`)}${kids.join('').replace(/U/g, `u${n}_`)}</svg>`;
const defs = '<defs><linearGradient id="Ug0"><stop offset="0"/></linearGradient><pattern id="Up1"><image href="media/bg.jpg"/></pattern><filter id="Uf2"/></defs>';
const bg = '<rect width="1280" height="720" fill="url(#Up1)"/>';
const deco = '<g transform="translate(10 10)"><path d="M0 0L5 5" fill="url(#Ug0)"/></g>';
const own = (t) => `<g data-uid="s1"><text x="1" y="2" filter="url(#Uf2)">${t}</text></g>`;

test('切开：第一个 data-uid 之前是背景段；两页只有页号和本页内容不同时缓存键相同', () => {
  const a = splitTemplate(page(0, defs, bg, deco, own('A')));
  const b = splitTemplate(page(7, defs, bg, deco, own('B')));
  assert.ok(a && b);
  assert.equal(a.key, b.key);
  assert.equal(a.template, page(0, defs, bg, deco));
  assert.equal(a.page, page(0, defs, own('A')));
});

test('背景段用到的定义不同（同一个 id）时缓存键不同；本页内容用到的定义不影响', () => {
  const k = (d) => splitTemplate(page(0, d, bg, deco, own('A'))).key;
  assert.notEqual(k(defs), k(defs.replace('offset="0"', 'offset="1"')));
  assert.equal(k(defs), k(defs.replace('<filter id="Uf2"/>', '<filter id="Uf2"><feGaussianBlur/></filter>')));
});

test('不切：没有本页内容、只有纯色底、有 style、两边互相引用对方定义的 id', () => {
  for (const svg of [
    page(0, defs, bg, deco),
    page(0, defs, '<rect width="1280" height="720" fill="#ffffff"/>', own('A')),
    page(0, defs, '<style>text{}</style>', bg, deco, own('A')),
    page(0, defs, bg, '<g><clipPath id="c9"><rect width="1" height="1"/></clipPath></g>', '<g data-uid="s1"><rect clip-path="url(#c9)"/></g>'),
  ]) assert.equal(splitTemplate(svg), undefined);
  // 图片做的整页背景（一个用图案填充的矩形）要切
  assert.ok(splitTemplate(page(0, defs, bg, own('A'))));
});

test('叠加：预乘透明度的前景源在上叠到背景，超过 255 的截断', () => {
  const bgImg = { width: 2, height: 2, data: new Uint8Array([10, 20, 30, 255, 200, 200, 200, 255, 0, 0, 0, 255, 255, 255, 255, 255]) };
  const fg = { width: 2, height: 2, data: new Uint8Array([0, 0, 0, 0, 255, 0, 0, 255, 64, 0, 0, 128, 140, 0, 0, 128]) };
  const out = composite(fg, bgImg).data;
  assert.deepEqual([...out.slice(0, 4)], [10, 20, 30, 255], '全透明：背景');
  assert.deepEqual([...out.slice(4, 8)], [255, 0, 0, 255], '不透明：前景');
  assert.deepEqual([...out.slice(8, 12)], [64, 0, 0, 255], '半透明叠在黑色上');
  assert.equal(out[12], 255, '颜色比不透明度大（不满足预乘）时截断');
  assert.equal(out[13], 127);
  assert.equal(composite(fg, { width: 1, height: 1, data: new Uint8Array(4) }), undefined, '尺寸不一样不叠');
});

test('缓存：按字节数淘汰最久没用的', async () => {
  const c = new TemplateCache(20);
  let paints = 0;
  const img = () => { paints++; return Promise.resolve({ width: 1, height: 2, data: new Uint8Array(8) }); };
  await c.get('a', img); await c.get('a', img);
  assert.equal(paints, 1, '同一个键只画一次');
  await c.get('b', img);
  await c.get('a', img);
  await c.get('c', img);  // 共 24 字节 > 20：淘汰最久没用的 b
  await c.get('b', img);
  assert.equal(paints, 4, 'b 被淘汰后要重画');
});
