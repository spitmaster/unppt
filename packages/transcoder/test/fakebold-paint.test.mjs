// 人工加粗（字体没有粗体字形）的描边和填充用同一种颜料：渐变、图片填充的文字描边也是同一个渐变、图片（不另生成定义）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const entry = [
  "export { textEl } from './packages/transcoder/src/text/svg-text.ts';",
  "export { SvgDoc } from './packages/transcoder/src/common/svg.ts';",
  "export { parseXml } from './packages/transcoder/src/io/xml.ts';",
].join('\n');
const r = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], logLevel: 'silent' });
const { textEl, SvgDoc, parseXml } = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));

const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const grad = parseXml(`<a:gradFill ${A}><a:gsLst><a:gs pos="0"><a:srgbClr val="DC0000"/></a:gs><a:gs pos="100000"><a:srgbClr val="0028DC"/></a:gs></a:gsLst><a:lin ang="0"/></a:gradFill>`);
const blip = parseXml(`<a:blipFill ${A}><a:blip/><a:stretch><a:fillRect/></a:stretch></a:blipFill>`);
const style = (extra) => ({
  size: 72, latin: 'SimSun', ea: 'SimSun', bold: false, fakeBold: true, italic: false, color: { r: 220, g: 0, b: 0, a: 1 },
  underline: false, strike: false, baseline: 0, spc: 0, caps: 'none', eaLang: true, eaBreak: true, ...extra,
});
const env = () => ({ doc: new SvgDoc('t'), colors: {}, lineBox: { x: 0, y: 0, w: 200, h: 86 }, blipHrefs: new Map([[blip, 'stripes.png']]) });
const attr = (svg, name) => new RegExp(` ${name}="([^"]*)"`).exec(svg)?.[1];

test('渐变文字人工加粗：描边和填充是同一个渐变，只生成一个定义', () => {
  const e = env();
  const out = textEl('渐变', 0, 60, style({ grad }), 'SimSun', false, undefined, e);
  assert.match(attr(out, 'fill'), /^url\(#t/);
  assert.equal(attr(out, 'stroke'), attr(out, 'fill'));
  assert.equal(e.doc.defsXml().match(/<linearGradient /g).length, 1);
});

test('图片填充的文字人工加粗：描边和填充是同一个图案', () => {
  const e = env();
  const out = textEl('图片', 0, 60, style({ blip }), 'SimSun', false, undefined, e);
  assert.match(attr(out, 'fill'), /^url\(#t/);
  assert.equal(attr(out, 'stroke'), attr(out, 'fill'));
  assert.equal(e.doc.defsXml().match(/<pattern /g).length, 1);
});

