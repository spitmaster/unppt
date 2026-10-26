// 相邻、同一个文字效果滤镜的 <text> 收进一组（两端对齐时中文每个字单独一段，不能每个字各做一遍滤镜）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const entry = [
  "export { groupFilters } from './packages/transcoder/src/text/emit.ts';",
  "export { textEl } from './packages/transcoder/src/text/svg-text.ts';",
  "export { SvgDoc } from './packages/transcoder/src/common/svg.ts';",
  "export { parseXml } from './packages/transcoder/src/io/xml.ts';",
].join('\n');
const r = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], logLevel: 'silent' });
const { groupFilters, textEl, SvgDoc, parseXml } = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));

const t = (c, f) => `<text x="0" y="0" fill="#000"${f ? ` filter="url(#${f})"` : ''} xml:space="preserve">${c}</text>`;

test('连续同一个滤镜的收进一组，滤镜挪到组上；单个的、不同滤镜的、没有滤镜的不动', () => {
  const out = groupFilters([t('a', 'f1'), t('b', 'f1'), t('c', 'f1'), t('d', 'f2'), t('e'), t('f', 'f1'), '<path d="M0 0"/>', t('g', 'f1'), t('h', 'f1')]);
  assert.deepEqual(out, [
    `<g filter="url(#f1)">${t('a')}${t('b')}${t('c')}</g>`,
    t('d', 'f2'),
    t('e'),
    t('f', 'f1'),
    '<path d="M0 0"/>',
    `<g filter="url(#f1)">${t('g')}${t('h')}</g>`,
  ]);
});

const g = (c, f) => `<g filter="url(#${f})"><g opacity="0.5">${t(c)}</g></g>`;

test('整段套在 <g filter> 里的（半透明人工加粗、轮廓加人工加粗）也收进组，和 <text> 上的滤镜混在一起也行', () => {
  const out = groupFilters([g('a', 'f1'), g('b', 'f1'), t('c', 'f1'), g('d', 'f2'), '<g transform="rotate(-90 0 0)"><text/></g>', g('e', 'f1')]);
  assert.deepEqual(out, [
    `<g filter="url(#f1)"><g opacity="0.5">${t('a')}</g><g opacity="0.5">${t('b')}</g>${t('c')}</g>`,
    g('d', 'f2'),
    '<g transform="rotate(-90 0 0)"><text/></g>',
    g('e', 'f1'),
  ]);
});

const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const shadow = parseXml(`<a:effectLst ${A}><a:outerShdw dist="76200" dir="10800000" algn="r"><a:srgbClr val="000000"><a:alpha val="60000"/></a:srgbClr></a:outerShdw></a:effectLst>`);
const style = (extra) => ({
  size: 72, latin: 'SimSun', ea: 'SimSun', bold: false, fakeBold: true, italic: false, color: { r: 220, g: 0, b: 0, a: 1 },
  underline: false, strike: false, baseline: 0, spc: 0, caps: 'none', eaLang: true, eaBreak: true, effects: shadow, ...extra,
});

test('分散对齐的带阴影人工加粗文字（每个字一段）：不透明、半透明、加轮廓的都只用一次滤镜', () => {
  const half = { r: 220, g: 0, b: 0, a: 0.5 };
  const outline = { color: { r: 60, g: 60, b: 60, a: 1 }, width: 1 };
  for (const extra of [{}, { color: half }, { outline }, { fakeBold: false, color: half }]) {
    const env = { doc: new SvgDoc('t'), colors: {}, gradBox: { w: 600, h: 100 } };
    const parts = [...'分散对齐'].map((c, i) => textEl(c, i * 100, 60, style(extra), 'SimSun', false, undefined, env));
    const out = groupFilters(parts).join('');
    assert.equal(out.match(/ filter="/g).length, 1, JSON.stringify(extra));
    assert.match(out, /^<g filter="url\(#t[^"]*\)">/);
    assert.equal(out.match(/<text /g).length, extra.outline ? 8 : 4);
  }
});
