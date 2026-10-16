// 整页图里透视投影的图片只画一次（mesh-warp.ts）：网格换成一张图片，画出来和逐个三角形画的几乎一样
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { libjpegTurbo } from '../../../scripts/esbuild-libjpeg.mjs';

async function load(entry) {
  const r = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], loader: { '.wasm': 'binary' }, plugins: [libjpegTurbo], logLevel: 'silent' });
  return import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
}
const { perspectiveMesh } = await load('packages/transcoder/src/style/perspective.ts');
const { SvgDoc } = await load('packages/transcoder/src/common/svg.ts');
const { warpMeshes } = await load('packages/transcoder/src/preview/mesh-warp.ts');
const { Preparer } = await load('packages/transcoder/src/preview/prepare.ts');
const { createPainter } = await load('packages/transcoder/src/preview/paint.ts');
const { decodeJpeg } = await load('packages/transcoder/src/media/jpeg.ts');

/** 一张 300×200 的"图片"（渐变底、几个色块、带阴影）绕竖轴转、透视投影，放在 (330, 170) */
function page() {
  const doc = new SvgDoc('u0_');
  doc.addDef('<linearGradient id="g"><stop offset="0" stop-color="#2060c0"/><stop offset="1" stop-color="#f0c040"/></linearGradient>');
  doc.addDef('<filter id="sh" filterUnits="userSpaceOnUse" x="-40" y="-40" width="380" height="280"><feGaussianBlur in="SourceAlpha" stdDeviation="6"/><feOffset dx="8" dy="8" result="o"/><feMerge><feMergeNode in="o"/><feMergeNode in="SourceGraphic"/></feMerge></filter>');
  const content = '<g filter="url(#sh)"><rect width="300" height="200" fill="url(#g)"/><circle cx="80" cy="70" r="40" fill="#c02020"/><rect x="170" y="110" width="100" height="60" fill="#20a040"/></g>';
  const d = 900, a = 0.6;
  const project = (x, y) => { const u = x - 150, v = y - 100, z = Math.sin(a) * u, f = d / (d - z); return [150 + Math.cos(a) * u * f, 100 + v * f]; };
  const mesh = perspectiveMesh(content, project, 300, 200, doc);
  const body = `<rect width="960" height="540" fill="#fff"/><g transform="translate(330 170)">${mesh}</g><text x="10" y="30">x</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540" width="960" height="540">${doc.defsXml()}${body}</svg>`;
}

test('网格换成一张图片：别的元素原样；不是网格的剪裁、只有一个三角形的不动', () => {
  const svg = page();
  assert.ok((svg.match(/<g clip-path=/g) ?? []).length > 10, '用例要有很多三角形');
  const calls = [];
  const out = warpMeshes(svg, 1, (content, width, warp) => { calls.push({ content, width, warp }); return 'unppt-raster:m0'; });
  assert.equal(calls.length, 1);
  assert.doesNotMatch(out, /<g clip-path=/);
  assert.match(out, /<g transform="translate\(330 170\)"><image href="unppt-raster:m0" x="-?\d+" y="-?\d+" width="\d+" height="\d+" preserveAspectRatio="none"\/><\/g><text x="10" y="30">x<\/text>/);
  // 内容 SVG 带着页面的定义（渐变、滤镜），宽度至少是投影后的像素宽
  assert.match(calls[0].content, /<linearGradient id="g">/);
  assert.match(calls[0].content, /filter="url\(#sh\)"/);
  assert.ok(calls[0].width >= calls[0].warp.dst[2]);
  const single = '<svg viewBox="0 0 10 10" width="10" height="10"><defs><clipPath id="c"><polygon points="0,0 5,0 0,5"/></clipPath></defs><g clip-path="url(#c)"><g transform="matrix(1 0 0 1 0 0)"><rect width="9" height="9"/></g></g></svg>';
  assert.equal(warpMeshes(single, 1, () => 'x'), single);
});

test('画出来和逐个三角形画的几乎一样（平均差 < 2 个色阶），三角形接缝不露白', async () => {
  const svg = page();
  const painter = await createPainter(await readFile('node_modules/@resvg/resvg-wasm/index_bg.wasm'));
  const size = { picWidth: 960, thumbWidth: 96, thumbHeight: 54 };
  // 对照：直接画网格（不经过准备）
  const direct = await painter.paint({ conv: 'mesh-a', page: 1, main: { svg, fonts: [] }, ...size },
    { font: async () => undefined, image: async () => undefined, template: async () => undefined, raster: async () => undefined });
  const prep = new Preparer(() => undefined, async () => undefined);
  const job = await prep.job(1, svg, size);
  assert.match(job.main.svg, /unppt-raster:/);
  const warped = await painter.paint(job, prep.resources);
  assert.deepEqual(warped.warnings, []);
  const a = decodeJpeg(direct.pic), b = decodeJpeg(warped.pic);
  let sum = 0, big = 0;
  for (let i = 0; i < a.data.length; i++) {
    const d = Math.abs(a.data[i] - b.data[i]);
    sum += d;
    if (d > 60) big++;
  }
  assert.ok(sum / a.data.length < 2, `平均差 ${(sum / a.data.length).toFixed(2)}`);
  assert.ok(big < a.data.length * 0.001, `差很多的 ${big}`);
});
