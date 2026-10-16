// 出图时展开 SVG 图片：序言、注释、DOCTYPE 实体、命名空间前缀；用了 xlink: 的 SVG 图片不能让整页画不出来（源码用 esbuild 现场打包后测试）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { libjpegTurbo } from '../../../scripts/esbuild-libjpeg.mjs';

async function load(entry) {
  const r = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], loader: { '.wasm': 'binary' }, plugins: [libjpegTurbo], logLevel: 'silent' });
  return import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
}
const { svgImageParts } = await load('packages/transcoder/src/preview/svg-image.ts');

const illustrator = `<?xml version="1.0" encoding="utf-8"?>
<!-- Generator: Adobe Illustrator -->
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [
  <!ENTITY ns_svg "http://www.w3.org/2000/svg">
  <!ENTITY ns_xlink "http://www.w3.org/1999/xlink">
  <!ENTITY st0 "fill:#336699;">
]>
<svg version="1.1" xmlns="&ns_svg;" xmlns:xlink="&ns_xlink;" viewBox="0 0 10 10"><defs><rect id="a" width="5" height="5" style="&st0;"/></defs><use xlink:href="#a"/></svg>
<!-- end -->`;

test('拆出根元素：跳过序言和结尾注释，展开 DOCTYPE 里的实体，带出前缀声明', () => {
  const p = svgImageParts(illustrator);
  assert.ok(p);
  assert.match(p.attrs, /viewBox="0 0 10 10"/);
  assert.equal(p.ns, ' xmlns:xlink="http://www.w3.org/1999/xlink"');
  assert.match(p.body, /style="fill:#336699;"/);
  assert.doesNotMatch(p.body + p.attrs, /&ns_|&st0/);
});

test('有认不出的实体时不展开（返回 undefined），预定义的实体照常', () => {
  assert.equal(svgImageParts('<svg viewBox="0 0 1 1"><text>&nbsp;</text></svg>'), undefined);
  assert.ok(svgImageParts('<svg viewBox="0 0 1 1"><text>A &amp; B &lt; C</text></svg>'));
  assert.equal(svgImageParts('不是 SVG'), undefined);
});

test('页面里有用 xlink: 和实体的 SVG 图片：整页照常画出来，图片也画上', async () => {
  const { Preparer } = await load('packages/transcoder/src/preview/prepare.ts');
  const { createPainter } = await load('packages/transcoder/src/preview/paint.ts');
  const painter = await createPainter(await readFile('node_modules/@resvg/resvg-wasm/index_bg.wasm'));
  const bytes = new TextEncoder().encode(illustrator);
  const prep = new Preparer(() => undefined, async (h) => (h === 'media/icon.svg' ? bytes : undefined));
  const page = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><rect width="100" height="100" fill="#fff"/><g data-uid="s1"><image href="media/icon.svg" x="0" y="0" width="100" height="100"/></g></svg>';
  const job = await prep.job(1, page, { picWidth: 100, thumbWidth: 50, thumbHeight: 50 });
  assert.match(job.main.svg, /<svg xmlns:xlink="http:\/\/www.w3.org\/1999\/xlink"/);
  const r = await painter.paint(job, prep.resources);
  assert.deepEqual(r.warnings, []);
  assert.ok(r.pic && r.pic[0] === 0xff);
});

test('有背景层编号但取不到背景层时：这一页报错、不出图（不能只画本页内容）', async () => {
  const { createPainter } = await load('packages/transcoder/src/preview/paint.ts');
  const painter = await createPainter(await readFile('node_modules/@resvg/resvg-wasm/index_bg.wasm'));
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><rect width="10" height="10"/></svg>';
  const r = await painter.paint({ conv: 'missing-bg', page: 1, main: { svg, fonts: [] }, template: 't0', picWidth: 100, thumbWidth: 50, thumbHeight: 50 },
    { font: async () => undefined, image: async () => undefined, template: async () => undefined });
  assert.equal(r.pic, undefined);
  assert.ok(r.warnings.some((w) => w.includes('背景层')));
});
