// 出图前的遮挡剔除：被铺满整页的不透明图片盖住的根元素不画；拿不准的情况一律不剔除（源码用 esbuild 现场打包后测试）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const r = await build({ entryPoints: ['packages/transcoder/src/preview/occlusion.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent' });
const { cullOccluded, opaqueImage } = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));

/** 最小的 PNG 头：IHDR（颜色类型 colorType）+ 可选 tRNS + IDAT */
function png(colorType, trns = false) {
  const chunk = (type, len) => [0, 0, 0, len, ...[...type].map((c) => c.charCodeAt(0)), ...new Array(len + 4).fill(0)];
  const ihdr = [0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, colorType, 0, 0, 0, 0, 0, 0, 0];
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...ihdr, ...(trns ? chunk('tRNS', 2) : []), ...chunk('IDAT', 4)]);
}
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(40).fill(0)]);
const files = { 'media/a.jpg': JPEG, 'media/rgb.png': png(2), 'media/rgba.png': png(6), 'media/trns.png': png(2, true) };
const images = async (h) => files[h];

const page = (...kids) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720">${kids.join('')}</svg>`;
const bg = '<rect width="1280" height="720" fill="#ffffff"/>';
const under = '<g data-uid="s1"><path d="M0 0L10 10"/></g>';
const cover = (href, extra = '', x = -10, y = 0, w = 1300, h = 720) => `<g transform="translate(${x} ${y})"><g><image href="${href}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none"${extra}/></g></g>`;
const top = '<g data-uid="s2"><text x="1" y="2">A</text></g>';

test('opaqueImage：JPEG、无透明通道的 PNG 算不透明；带透明通道、带 tRNS 的不算', () => {
  assert.equal(opaqueImage(JPEG), true);
  assert.equal(opaqueImage(png(2)), true);
  assert.equal(opaqueImage(png(0)), true);
  assert.equal(opaqueImage(png(6)), false);
  assert.equal(opaqueImage(png(2, true)), false);
  assert.equal(opaqueImage(undefined), false);
});

test('铺满整页的不透明图片：它下面的根元素剔除，上面的保留', async () => {
  const out = await cullOccluded(page(bg, under, cover('media/a.jpg'), top), images);
  assert.equal(out, page(cover('media/a.jpg'), top));
  assert.equal(await cullOccluded(page(bg, under, cover('media/rgb.png'), top), images), page(cover('media/rgb.png'), top));
});

test('defs、style 保留', async () => {
  const defs = '<defs><linearGradient id="g1"/></defs>', style = '<style>text{fill:red}</style>';
  assert.equal(await cullOccluded(page(defs, style, under, cover('media/a.jpg')), images), page(defs, style, cover('media/a.jpg')));
});

test('拿不准时不剔除：透明图片、没铺满、带透明度或变换、被剔除部分的 id 还有人用', async () => {
  for (const svg of [
    page(bg, under, cover('media/rgba.png'), top),
    page(bg, under, cover('media/trns.png'), top),
    page(bg, under, cover('media/a.jpg', '', 10), top),
    page(bg, under, cover('media/a.jpg', '', -10, 0, 1300, 700), top),
    page(bg, under, cover('media/a.jpg', ' opacity="0.5"'), top),
    page(bg, under, cover('media/missing.jpg'), top),
    page(bg, under, '<g transform="scale(2)"><image href="media/a.jpg" x="0" y="0" width="1280" height="720" preserveAspectRatio="none"/></g>', top),
    page(bg, '<g><clipPath id="c1"><rect width="5" height="5"/></clipPath></g>', cover('media/a.jpg'), '<g clip-path="url(#c1)"><rect width="9" height="9"/></g>'),
  ]) assert.equal(await cullOccluded(svg, images), svg);
});
