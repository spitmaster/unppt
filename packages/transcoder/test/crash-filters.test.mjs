// resvg 崩溃时找出是哪几处滤镜引起的（用假的"画图"函数：留着某几处滤镜就画不出来）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { libjpegTurbo } from '../../../scripts/esbuild-libjpeg.mjs';

async function load(entry) {
  const r = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], loader: { '.wasm': 'binary' }, plugins: [libjpegTurbo], logLevel: 'silent' });
  return import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
}
const { dropCrashingFilters } = await load('packages/transcoder/src/preview/crash-filters.ts');

const page = (n) => `<svg>${Array.from({ length: n }, (_, k) => `<g id="e${k}" filter="url(#f${k % 3})"/>`).join('')}</svg>`;
/** 留着 bad 里任何一个元素的滤镜就"崩溃" */
const painter = (bad) => {
  let tries = 0;
  const attempt = async (svg) => {
    tries++;
    for (const k of bad) if (new RegExp(`id="e${k}" filter=`).test(svg)) return undefined;
    return svg;
  };
  return { attempt, tries: () => tries };
};

test('会崩溃的连在一起：只去掉这一段的滤镜；不连在一起：从第一处到最后一处都去掉，别的照留', async () => {
  for (const bad of [[0], [7], [53], [20, 21, 22, 23], [40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53], [3, 40], [10, 11, 30]]) {
    const p = painter(bad);
    const r = await dropCrashingFilters(page(54), p.attempt);
    assert.ok(r, `${bad}`);
    const lo = Math.min(...bad), hi = Math.max(...bad);
    const left = [...r.result.matchAll(/id="e(\d+)" filter=/g)].map((m) => Number(m[1]));
    assert.deepEqual(left, Array.from({ length: 54 }, (_, k) => k).filter((k) => k < lo || k > hi), `${bad}`);
    assert.deepEqual(r.dropped, Array.from({ length: hi - lo + 1 }, (_, i) => `f${(lo + i) % 3}`));
    assert.ok(p.tries() <= 13, `${bad} 试画 ${p.tries()} 次`);
  }
});

test('没有滤镜、去掉所有滤镜也画不出来：不是滤镜的问题，返回 undefined', async () => {
  assert.equal(await dropCrashingFilters('<svg><g/></svg>', async (s) => s), undefined);
  assert.equal(await dropCrashingFilters(page(5), async () => undefined), undefined);
});

test('真的 resvg：画布外很远的元素带阴影会崩溃，只去掉它的阴影，画布里的阴影照画', async () => {
  const { createPainter } = await load('packages/transcoder/src/preview/paint.ts');
  const painter = await createPainter(await readFile('node_modules/@resvg/resvg-wasm/index_bg.wasm'));
  const f = '<filter id="f" filterUnits="userSpaceOnUse" x="-30" y="-30" width="300" height="200"><feGaussianBlur in="SourceAlpha" stdDeviation="5"/></filter>';
  // 实测：滤镜范围的左边落在画布右边两倍画布宽以外时 resvg 崩溃
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540" width="720" height="405"><defs>${f}</defs>`
    + '<g transform="translate(100 100)"><g filter="url(#f)"><rect width="240" height="130" fill="red"/></g></g>'
    + '<g transform="translate(2100 30)"><g filter="url(#f)"><rect width="240" height="130" fill="red"/></g></g></svg>';
  const r = await painter.paint({ conv: 'far', page: 1, main: { svg, fonts: [] }, picWidth: 1280, thumbWidth: 216, thumbHeight: 122 },
    { font: async () => undefined, image: async () => undefined, template: async () => undefined, raster: async () => undefined });
  assert.ok(r.pic, '照样出图');
  assert.ok(r.warnings.some((w) => w.includes('1 处效果')), r.warnings.join('\n'));
});
