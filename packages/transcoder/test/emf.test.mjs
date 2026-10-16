// EMF -> SVG：文字记录里带 NUL 等 XML 不允许的字符时去掉（连同它的位置），整张 SVG 仍是合法的 XML（源码用 esbuild 现场打包后测试；EMF 现场拼）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { readFile } from 'node:fs/promises';

const r = await build({ stdin: { contents: `export { emfToSvg } from './packages/transcoder/src/media/emf.ts';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent' });
const { emfToSvg } = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));

/** 拼一个 EMF：文件头、建字体、选字体、一条 EXTTEXTOUTW（每个字 100 个逻辑单位宽）、结束 */
function emf(text) {
  const recs = [];
  const rec = (type, body) => { const b = new Uint8Array(8 + body.length); const v = new DataView(b.buffer); v.setUint32(0, type, true); v.setUint32(4, b.length, true); b.set(body, 8); recs.push(b); };
  const buf = (n) => { const b = new Uint8Array(n); return [b, new DataView(b.buffer)]; };
  // 文件头：Bounds、Frame（0.01 毫米）、签名、设备像素和毫米
  const [h, hv] = buf(80);
  hv.setInt32(8, 1000, true); hv.setInt32(12, 1000, true);           // Bounds 右下（记录头 8 字节之后的偏移：Bounds 在 0..16）
  hv.setInt32(24, 26458, true); hv.setInt32(28, 26458, true);        // Frame 右下（约 1000 像素）
  hv.setUint32(32, 0x464d4520, true);                                // 签名（文件偏移 40）
  hv.setInt32(64, 1000, true); hv.setInt32(68, 1000, true);          // Device 像素
  hv.setInt32(72, 265, true); hv.setInt32(76, 265, true);            // Millimeters
  rec(1, h);
  // 字体：ihFont=1，LOGFONTW 高 -40，字体名 Arial
  const [f, fv] = buf(4 + 92);
  fv.setUint32(0, 1, true); fv.setInt32(4, -40, true); fv.setInt32(20, 400, true);
  [...'Arial'].forEach((c, k) => fv.setUint16(4 + 28 + k * 2, c.charCodeAt(0), true));
  rec(82, f);
  const [s, sv] = buf(4); sv.setUint32(0, 1, true); rec(37, s);
  // EXTTEXTOUTW：Bounds(16) 图形模式 缩放 缩放(12)，EMRTEXT：参考点、字数、字符串偏移、选项(ETO_NO_RECT)、间距数组偏移
  const n = text.length, strOff = 8 + 28 + 24, dxOff = strOff + Math.ceil(n * 2 / 4) * 4;
  const [t, tv] = buf(dxOff - 8 + n * 4);
  tv.setInt32(28, 10, true); tv.setInt32(32, 500, true); tv.setUint32(36, n, true); tv.setUint32(40, strOff, true); tv.setUint32(44, 0x100, true); tv.setUint32(48, dxOff, true);
  for (let k = 0; k < n; k++) { tv.setUint16(strOff - 8 + k * 2, text.charCodeAt(k), true); tv.setInt32(dxOff - 8 + k * 4, 100, true); }
  rec(84, t);
  rec(14, new Uint8Array(12));
  const out = new Uint8Array(recs.reduce((a, b) => a + b.length, 0));
  let o = 0; for (const b of recs) { out.set(b, o); o += b.length; }
  return out;
}

test('文字里的 NUL 去掉，后面的字位置不乱；SVG 能被 resvg 解析', async () => {
  const svg = emfToSvg(emf('AB\u0000C\u0000'));
  assert.ok(svg);
  assert.doesNotMatch(svg, /[\u0000-\u0008]/);
  const m = /<text x="([^"]+)"[^>]*>([^<]*)<\/text>/.exec(svg);
  assert.equal(m[2], 'ABC');
  // A、B、C 的起点：10、110、310（NUL 占的 210 那一格跳过）
  assert.deepEqual(m[1].split(' ').map(Number), [10, 110, 310]);
  await initWasm(await readFile('node_modules/@resvg/resvg-wasm/index_bg.wasm'));
  const rv = new Resvg(svg);
  rv.render().free();
  rv.free();
});
