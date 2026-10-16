// WMF -> SVG：窗口范围是负数（MM_ANISOTROPIC 下逻辑坐标朝上）、位图目标高度是负数（上下翻转）时照样画出来、方向正确
// （源码用 esbuild 现场打包后测试；WMF 现场拼）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const r = await build({ stdin: { contents: `export { wmfToSvg } from './packages/transcoder/src/media/wmf.ts';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent' });
const { wmfToSvg } = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));

/** 拼一个 WMF：窗口原点 (0,0)、范围 (w, h)，一条 DIBSTRETCHBLT 把 1×2 的位图画到 (0,0) 起、宽 w 高 dh */
function wmf(w, h, dh) {
  const recs = [];
  const rec = (fn, params) => {
    const b = new Uint8Array(6 + params.length);
    const v = new DataView(b.buffer);
    v.setUint32(0, b.length / 2, true);
    v.setUint16(4, fn, true);
    b.set(params, 6);
    recs.push(b);
  };
  const i16s = (...vs) => { const b = new Uint8Array(vs.length * 2); const v = new DataView(b.buffer); vs.forEach((x, k) => v.setInt16(k * 2, x, true)); return b; };
  rec(0x0103, i16s(8));                 // SETMAPMODE MM_ANISOTROPIC
  rec(0x020b, i16s(0, 0));              // SETWINDOWORG（y, x）
  rec(0x020c, i16s(h, w));              // SETWINDOWEXT（y, x）
  // DIB：BITMAPINFOHEADER + 1×2、24 位（每行补到 4 字节）。底朝上存：第一行是图片下面那一行（蓝）
  const dib = new Uint8Array(40 + 8);
  const dv = new DataView(dib.buffer);
  dv.setUint32(0, 40, true); dv.setInt32(4, 1, true); dv.setInt32(8, 2, true); dv.setUint16(12, 1, true); dv.setUint16(14, 24, true);
  dib.set([255, 0, 0, 0], 40);          // 下面一行：蓝（BGR）
  dib.set([0, 0, 255, 0], 44);          // 上面一行：红
  const params = new Uint8Array(4 + 16 + dib.length);
  const pv = new DataView(params.buffer);
  pv.setUint32(0, 0xcc0020, true);      // SRCCOPY
  [2, 1, 0, 0, dh, w, 0, 0].forEach((x, k) => pv.setInt16(4 + k * 2, x, true));   // 源高、源宽、源 y、源 x、目标高、目标宽、目标 y、目标 x
  params.set(dib, 20);
  rec(0x0b41, params);
  rec(0x0000, new Uint8Array(0));
  const body = recs.reduce((n, b) => n + b.length, 0);
  const hdr = new Uint8Array(18);
  const hv = new DataView(hdr.buffer);
  hv.setUint16(0, 1, true); hv.setUint16(2, 9, true); hv.setUint16(4, 0x300, true); hv.setUint32(6, (18 + body) / 2, true);
  const out = new Uint8Array(18 + body);
  out.set(hdr, 0);
  let o = 18;
  for (const b of recs) { out.set(b, o); o += b.length; }
  return out;
}

test('普通的窗口范围、目标高度：位图原样放在 (0,0)~(100,200)，不翻转', () => {
  const svg = wmfToSvg(wmf(100, 200, 200));
  assert.match(svg, /viewBox="0 0 100 200"/);
  assert.match(svg, /<image href="data:image\/[a-z]+;base64,[^"]+" x="0" y="0" width="100" height="200" preserveAspectRatio="none"\/>/);
  assert.doesNotMatch(svg, /scale\(/);
});

test('窗口范围高度、目标高度都是负数：viewBox 用绝对值，内容整体上下翻转，位图自己也翻转（两次翻转后是正的）', () => {
  const svg = wmfToSvg(wmf(100, -200, -200));
  assert.match(svg, /viewBox="0 0 100 200"/);
  assert.match(svg, /<g transform="matrix\(1 0 0 -1 0 0\)">/);
  // 位图占 y = -200..0，自己上下翻转后再随整体翻到 0..200
  assert.match(svg, /<image href="[^"]+" x="0" y="-200" width="100" height="200" preserveAspectRatio="none" transform="translate\(0 -200\) scale\(1 -1\)"\/>/);
});
