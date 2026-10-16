// 出图时 feMorphology 拆成两遍：改写规则，以及 resvg 画出来的外框和浏览器（Chrome：半径四舍五入成 R，窗口 [-R, R]）一致
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { initWasm, Resvg } from '@resvg/resvg-wasm';

const r = await build({ entryPoints: ['packages/transcoder/src/preview/morphology.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent' });
const { splitMorphology } = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));

const page = (filter, body = '<rect width="10" height="10" filter="url(#f)"/>') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="300" height="300"><defs>${filter}</defs>${body}</svg>`;

test('拆成横、竖两遍再平移 -1 像素；in、result 接上，其它属性两遍都带', () => {
  const out = splitMorphology(page('<filter id="f"><feMorphology in="SourceAlpha" operator="dilate" radius="9.6" color-interpolation-filters="sRGB" result="d"/><feGaussianBlur in="d" stdDeviation="2"/></filter>'));
  // 9.6 × 0.75 = 7.2 -> R = 7；每遍 (7 - 0.5) / 0.75 = 8.67；平移 -1.5 / 0.75 = -2
  assert.match(out, /<feMorphology in="SourceAlpha" operator="dilate" color-interpolation-filters="sRGB" radius="8\.67 0" result="unppt-m0a"\/>/);
  assert.match(out, /<feMorphology in="unppt-m0a" operator="dilate" color-interpolation-filters="sRGB" radius="0 8\.67" result="unppt-m0b"\/>/);
  assert.match(out, /<feOffset in="unppt-m0b" dx="-2" dy="-2" result="d"\/><feGaussianBlur in="d"/);
  // 两个半径
  assert.match(splitMorphology(page('<filter id="f"><feMorphology radius="9.6 4"/></filter>')), /radius="8\.67 0".*radius="0 3\.33"/);
});

test('不动：子区域、objectBoundingBox、半径不是正数、某一个方向四舍五入后是 0；两个方向都是 0 时原样输出', () => {
  for (const f of [
    '<filter id="f"><feMorphology radius="5" x="0" y="0" width="10" height="10"/></filter>',
    '<filter id="f" primitiveUnits="objectBoundingBox"><feMorphology radius="0.1"/></filter>',
    '<filter id="f"><feMorphology radius="0"/></filter>',
    '<filter id="f"><feMorphology radius="5 -1"/></filter>',
    '<filter id="f"><feMorphology operator="dilate"/></filter>',
    '<filter id="f"><feMorphology radius="5 0.4"/></filter>',
  ]) assert.equal(splitMorphology(page(f)), page(f));
  assert.equal(splitMorphology(page('<filter id="f"><feMorphology in="SourceAlpha" radius="0.4" result="d"/></filter>')), page('<filter id="f"><feOffset in="SourceAlpha" result="d"/></filter>'));
});

test('resvg 画出来的外框和 Chrome 一致（膨胀、腐蚀，缩放 0.75）', async () => {
  await initWasm(await readFile('node_modules/@resvg/resvg-wasm/index_bg.wasm'));
  // 方块：膨胀用 40×40（画出来 30×30 像素，左上角 120），腐蚀用 120×120（90×90，左上角 90）
  const box = (svg) => {
    const rv = new Resvg(svg);
    const img = rv.render();
    const px = img.pixels, w = img.width;
    let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1;
    for (let i = 3; i < px.length; i += 4) if (px[i] > 127) { const p = (i - 3) / 4, x = p % w, y = (p / w) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    img.free(); rv.free();
    return [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
  };
  for (const op of ['dilate', 'erode']) {
    for (const [rx, ry] of [[1, 1], [2.4, 2.4], [4, 4], [9.6, 9.6], [13.3, 13.3], [26.67, 26.67], [9.6, 4]]) {
      const [a, size, sign] = op === 'dilate' ? [160, 40, 1] : [120, 120, -1];
      const svg = page(`<filter id="f" filterUnits="userSpaceOnUse" x="0" y="0" width="400" height="400"><feMorphology operator="${op}" radius="${rx} ${ry}"/></filter>`,
        `<rect x="${a}" y="${a}" width="${size}" height="${size}" fill="#000" filter="url(#f)"/>`);
      const Rx = Math.round(rx * 0.75), Ry = Math.round(ry * 0.75), p = a * 0.75, q = size * 0.75;
      assert.deepEqual(box(splitMorphology(svg)), [p - sign * Rx, p - sign * Ry, q + sign * 2 * Rx, q + sign * 2 * Ry], `${op} ${rx} ${ry}`);
    }
  }
});
