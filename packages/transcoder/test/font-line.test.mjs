// SmartArt 文字的行模型（text/font-line.ts）：行高按字体度量、基线位置（源码用 esbuild 现场打包后测试；数字是 COM 实测的，见 SPEC 第 7 节）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const r = await build({ entryPoints: ['packages/transcoder/src/text/font-line.ts'], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { fontLine, mergeLines, fontLineBaseline } = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));

// 字体的 win 上下伸（em）、GDI 外部行距、代码页是不是中日韩（本机字体文件里读的）
const YAHEI = { ascent: 2167 / 2048, descent: 536 / 2048, extLeading: 0, eastAsian: true };
const SIMSUN = { ascent: 220 / 256, descent: 36 / 256, extLeading: 36 / 256, eastAsian: true };
const ARIAL = { ascent: 1854 / 2048, descent: 434 / 2048, extLeading: 67 / 2048, eastAsian: false };
const CALIBRI = { ascent: 1950 / 2048, descent: 550 / 2048, extLeading: 0, eastAsian: false };
const PT = 96 / 72;
const near = (a, b, tol = 0.05) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);

test('单倍行高：中日韩字体 1.3 × 上下伸，其它字体上下伸 + 外部行距（20 磅：雅黑 34.3、宋体 26.0、Arial 23.0、Calibri 24.4 磅）', () => {
  const h = (m) => { const l = fontLine(m, 20 * PT); return (l.b + l.d) / PT; };
  near(h(YAHEI), 34.316);
  near(h(SIMSUN), 26.0);
  near(h(ARIAL), 23.0);
  near(h(CALIBRI), 24.415);
});

test('一行里几种字体：基线以上、以下各取最大，规则按行高最大的字体', () => {
  const l = mergeLines([fontLine(CALIBRI, 20 * PT), fontLine(YAHEI, 20 * PT)]);
  near((l.b + l.d) / PT, 34.316);
  assert.equal(l.ea, true);
});

test('基线：雅黑 70%~200% 行距（比单倍多出的高度 75% 在上面）；Arial 和普通文字一样', () => {
  const y = fontLine(YAHEI, 20 * PT), single = y.b + y.d;
  // 实测（顶端对齐，第一行基线离内边距上沿，磅）：70% 17.5、100% 25.0、150% 38.0、200% 50.75
  near(fontLineBaseline(y, 0.7 * single) / PT, 17.5, 0.2);
  near(fontLineBaseline(y, single) / PT, 25.0, 0.2);
  near(fontLineBaseline(y, 1.5 * single) / PT, 38.0, 0.35);
  near(fontLineBaseline(y, 2 * single) / PT, 50.75, 0.55);
  const a = fontLine(ARIAL, 20 * PT), sa = a.b + a.d;
  // Arial：70% 12.0（停在 0.75 × 行高）、90% 16.5（从上面扣）、100% 18.75、150% 26.0（0.75 × 行高）
  near(fontLineBaseline(a, 0.7 * sa) / PT, 12.0, 0.15);
  near(fontLineBaseline(a, 0.9 * sa) / PT, 16.5, 0.15);
  near(fontLineBaseline(a, sa) / PT, 18.75, 0.15);
  near(fontLineBaseline(a, 1.5 * sa) / PT, 26.0, 0.15);
});
