// 整页图里的预设图案填充抗锯齿画：0.75 倍下点阵的深浅和按面积缩小的一致（源码用 esbuild 现场打包后测试）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { libjpegTurbo } from '../../../scripts/esbuild-libjpeg.mjs';

async function load(entry) {
  const r = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], loader: { '.wasm': 'binary' }, plugins: [libjpegTurbo], logLevel: 'silent' });
  return import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
}
const { smoothPatterns } = await load('packages/transcoder/src/preview/pattern-smooth.ts');
const { patternFill } = await load('packages/transcoder/src/style/pattern.ts');
const { SvgDoc } = await load('packages/transcoder/src/common/svg.ts');
const { PATTERNS } = await load('packages/transcoder/src/style/patterns-data.ts');
const { createPainter } = await load('packages/transcoder/src/preview/paint.ts');
const { decodeJpeg } = await load('packages/transcoder/src/media/jpeg.ts');

const black = { r: 0, g: 0, b: 0, a: 1 }, white = { r: 255, g: 255, b: 255, a: 1 };

/** 一页 1280×720 的用户单位、画成 960 宽：左右两个矩形分别用 prst 图案填充（偏移不同，原点对齐不同） */
function page(prst) {
  const doc = new SvgDoc('t');
  const a = patternFill(doc, prst, black, white), b = patternFill(doc, prst, black, white, { x: 3.3, y: 1.7 });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="960" height="540">${doc.defsXml()}`
    + `<rect x="40" y="40" width="560" height="640" fill="url(#${a})"/><g transform="translate(3.3 1.7)"><rect x="677" y="38" width="560" height="640" fill="url(#${b})"/></g></svg>`;
}

test('pattern.ts 生成的预设图案前景都去掉 crispEdges，别的 crispEdges（矩形渐变、EMF）不动', () => {
  for (const prst of ['pct5', 'ltUpDiag', 'smGrid']) {
    const svg = page(prst);
    assert.equal((svg.match(/crispEdges/g) ?? []).length, 2);
    assert.equal(smoothPatterns(svg).includes('crispEdges'), false, prst);
  }
  const other = '<pattern id="rg1" patternUnits="userSpaceOnUse" width="10" height="10"><g shape-rendering="crispEdges"><rect width="5" height="5"/></g></pattern><rect shape-rendering="crispEdges"/>';
  assert.equal(smoothPatterns(other), other);
});

test('0.75 倍下：抗锯齿画的点阵平均深浅等于点的面积占比，不抗锯齿时偏离很多', async () => {
  const painter = await createPainter(await readFile('node_modules/@resvg/resvg-wasm/index_bg.wasm'));
  const res = { font: async () => undefined, image: async () => undefined, template: async () => undefined, raster: async () => undefined };
  const mean = async (svg, x0) => {
    const r = await painter.paint({ conv: 'pat', page: 1, main: { svg, fonts: [] }, picWidth: 960, thumbWidth: 96, thumbHeight: 54 }, res);
    const img = decodeJpeg(r.pic);
    let s = 0, n = 0;
    for (let y = 60; y < 480; y++) for (let x = x0; x < x0 + 360; x++) { s += img.data[(y * img.width + x) * 3]; n++; }
    return s / n;
  };
  for (const prst of ['pct5', 'pct20', 'ltUpDiag', 'smGrid']) {
    const bits = [...PATTERNS[prst]].reduce((k, h) => k + [...parseInt(h, 16).toString(2)].filter((c) => c === '1').length, 0);
    const want = 255 * (1 - bits / 64);
    for (const x0 of [60, 540]) {
      const smooth = await mean(smoothPatterns(page(prst)), x0), crisp = await mean(page(prst), x0);
      assert.ok(Math.abs(smooth - want) < 3, `${prst} 抗锯齿：${smooth.toFixed(1)}，应为 ${want.toFixed(1)}`);
      // 不抗锯齿时 5% 深 8 级、浅色斜线浅 6 级、小网格深 30 级（20% 的点碰巧落得匀，只差 2 级）
      if (prst !== 'pct20') assert.ok(Math.abs(crisp - want) > 5, `${prst} 不抗锯齿：${crisp.toFixed(1)}`);
    }
  }
});
