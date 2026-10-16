// EMF -> SVG 的定义去重：相同的裁剪区域共用一个 id；同一张位图用到两次以上时只嵌入一次（源码用 esbuild 现场打包后测试）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const r = await build({ stdin: { contents: `export { EmfDefs } from './packages/transcoder/src/media/emf-defs.ts'; export { inlineSvgImages, RASTER_BYTES } from './packages/transcoder/src/preview/inline-svg.ts';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent' });
const { EmfDefs, inlineSvgImages, RASTER_BYTES } = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));

test('裁剪区域：内容和上一层都相同的共用一个 id', () => {
  let n = 0;
  const d = new EmfDefs((p) => `${p}${n++}`);
  const a = d.clip('<rect width="1" height="1"/>');
  assert.equal(d.clip('<rect width="1" height="1"/>'), a);
  const b = d.clip('<rect width="1" height="1"/>', a);
  assert.notEqual(b, a);
  assert.equal(d.clip('<rect width="1" height="1"/>', a), b);
  assert.equal(d.defs.length, 2);
});

test('位图：只用一次的照旧直接写；用两次以上的放进 defs，各处引用', () => {
  let n = 0;
  const d = new EmfDefs((p) => `${p}${n++}`);
  const once = d.bitmap('data:A', 1, 2, 3, 4, '');
  const t1 = d.bitmap('data:B', 0, 0, 10, 20, ' opacity="0.5"');
  const t2 = d.bitmap('data:B', 5, 5, 10, 20, ' clip-path="url(#c0)"');
  const out = d.finish(once + t1 + t2);
  assert.match(out, /^<image href="data:A" x="1" y="2" width="3" height="4" preserveAspectRatio="none"\/>/);
  assert.equal((out.match(/data:B/g) ?? []).length, 0, '引用处不再带位图数据');
  assert.equal(d.defs.filter((x) => x.includes('data:B')).length, 1);
  assert.match(out, /<g opacity="0.5"><use href="#b0" transform="matrix\(10 0 0 20 0 0\)"\/><\/g>/);
  assert.match(out, /<g clip-path="url\(#c0\)"><use href="#b0" transform="matrix\(10 0 0 20 5 5\)"\/><\/g>/);
});

test('同一页里重复很多次的大 SVG 图片画成位图；小图标重复几次照常展开', async () => {
  const big = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' + '<rect width="1" height="1"/>'.repeat(Math.ceil(RASTER_BYTES / 3 / 28)) + '</svg>';
  const small = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="5" height="5"/></svg>';
  const files = { 'big.svg': new TextEncoder().encode(big), 'small.svg': new TextEncoder().encode(small) };
  const page = (href) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="960" height="540">${[0, 1, 2].map((i) => `<image href="${href}" x="${i}" y="0" width="100" height="100"/>`).join('')}</svg>`;
  const calls = [];
  const raster = (key, svg, width) => { calls.push({ key, width, xmlns: (svg.match(/xmlns="/g) ?? []).length }); return 'unppt-raster:r0'; };
  const outBig = await inlineSvgImages(page('big.svg'), async (h) => files[h], raster);
  assert.equal((outBig.match(/unppt-raster:r0/g) ?? []).length, 3);
  assert.deepEqual(calls, [{ key: 'big.svg@150', width: 150, xmlns: 1 }], '画一次；宽 = 100 × 0.75 × 2；不重复声明命名空间');
  const outSmall = await inlineSvgImages(page('small.svg'), async (h) => files[h], raster);
  assert.equal(calls.length, 1);
  assert.equal((outSmall.match(/<svg x=/g) ?? []).length, 3, '小图标照常展开');
});

test('连续用同一个裁剪的元素收进一个 g；单个的、中间隔开的保持原样', async () => {
  const r2 = await build({ stdin: { contents: `export { groupClips } from './packages/transcoder/src/media/emf-defs.ts';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent' });
  const { groupClips } = await import('data:text/javascript;base64,' + Buffer.from(r2.outputFiles[0].text).toString('base64'));
  const p = (d, c) => `<path d="${d}"${c ? ` clip-path="url(#${c})"` : ''}/>`;
  const t = '<text x="1" y="2" clip-path="url(#c1)">A</text>';
  assert.equal(groupClips([p('M1', 'c1'), p('M2', 'c1'), t, p('M3', 'c2'), p('M4'), p('M5', 'c1')]),
    `<g clip-path="url(#c1)">${p('M1')}${p('M2')}<text x="1" y="2">A</text></g>${p('M3', 'c2')}${p('M4')}${p('M5', 'c1')}`);
  // 子元素里的裁剪不算（只看元素自己的开始标签）
  const g = '<g fill="red"><path d="M0" clip-path="url(#c1)"/></g>';
  assert.equal(groupClips([g, g]), g + g);
});
