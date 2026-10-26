// WMF -> SVG：窗口范围是负数（MM_ANISOTROPIC 下逻辑坐标朝上）、位图目标高度是负数（上下翻转）时照样画出来、方向正确；图案画刷按平均色填
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

/** 拼一个 WMF：先选黑色实心画刷，再建图案画刷（8×8、8 位、红白棋盘格 / 不带颜色表的单色图案）选进来画矩形 */
function wmfPattern(mono) {
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
  rec(0x020c, i16s(100, 100));                              // SETWINDOWEXT（y, x）
  rec(0x02fc, new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]));    // CREATEBRUSHINDIRECT：黑色实心 -> 0
  rec(0x012d, i16s(0));
  rec(0x0209, new Uint8Array([0, 0, 255, 0]));              // SETTEXTCOLOR 蓝
  rec(0x0201, new Uint8Array([255, 255, 0, 0]));            // SETBKCOLOR 黄
  const bits = mono ? 1 : 8, pal = mono ? 0 : 2, stride = mono ? 4 : 8;
  const dib = new Uint8Array(40 + pal * 4 + stride * 8), dv = new DataView(dib.buffer);
  dv.setUint32(0, 40, true); dv.setInt32(4, 8, true); dv.setInt32(8, 8, true); dv.setUint16(12, 1, true); dv.setUint16(14, bits, true); dv.setUint32(32, pal, true);
  if (!mono) { dib.set([40, 40, 220, 0, 255, 255, 255, 0], 40); for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) dib[48 + y * 8 + x] = (x + y) % 2; }
  else for (let y = 0; y < 8; y++) dib[40 + y * 4] = y % 4 ? 0x00 : 0xff;   // 1/4 的行是 1
  const p = new Uint8Array(4 + dib.length);
  p.set(i16s(5, mono ? 2 : 0), 0); p.set(dib, 4);           // BS_DIBPATTERN、DIB_RGB_COLORS / DIB_PAL_INDICES
  rec(0x0142, p);                                           // DIBCREATEPATTERNBRUSH -> 1
  rec(0x012d, i16s(1));
  rec(0x041b, i16s(90, 90, 10, 10));                        // RECTANGLE（下、右、上、左）
  rec(0x0000, new Uint8Array(0));
  const body = recs.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(18 + body), hv = new DataView(out.buffer);
  hv.setUint16(0, 1, true); hv.setUint16(2, 9, true); hv.setUint16(4, 0x300, true); hv.setUint32(6, (18 + body) / 2, true); hv.setUint16(10, 2, true);
  let o = 18;
  for (const b of recs) { out.set(b, o); o += b.length; }
  return out;
}

test('图案画刷（DIBCREATEPATTERNBRUSH）：用图案的平均色填，不再沿用上一个黑色画刷', () => {
  const svg = wmfToSvg(wmfPattern(false));
  // 红 (220,40,40) 和白各一半
  assert.match(svg, /<path d="M10 10H90V90H10Z" fill="#ee9494"/);
});

test('不带颜色表的单色图案画刷：0 用文字色、1 用背景色，按比例混', () => {
  const svg = wmfToSvg(wmfPattern(true));
  // 3/4 蓝 (0,0,255) + 1/4 黄 (255,255,0)
  assert.match(svg, /<path d="M10 10H90V90H10Z" fill="#4040bf"/);
});
