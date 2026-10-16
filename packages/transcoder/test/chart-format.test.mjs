// 图表的数字格式（坐标轴、数据标签）：分段、方括号部分、千分位、小数位、百分比、字面文字、日期（源码用 esbuild 现场打包后测试）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const r = await build({ entryPoints: ['packages/transcoder/src/chart/format.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], logLevel: 'silent' });
const { formatNumber: f } = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));

test('[Red] 之类的方括号部分不当日期（样本里坐标轴显示成了 1900/4/9）；负数用第二段', () => {
  assert.equal(f(109, '0_);[Red]\\(0\\)'), '109 ');
  assert.equal(f(-5, '0_);[Red]\\(0\\)'), '(5)');
  assert.equal(f(7, '[$-804]0"人"'), '7人');
});

test('千分位、货币符号、小数位、可省的小数位、按千缩小', () => {
  assert.equal(f(1234567, '#,##0'), '1,234,567');
  assert.equal(f(40, '$#,##0'), '$40');
  assert.equal(f(40, '"$"#,##0'), '$40');
  assert.equal(f(3.14159, '0.00'), '3.14');
  assert.equal(f(2.5, '0'), '3');
  assert.equal(f(1.5, '0.##'), '1.5');
  assert.equal(f(2, '0.##'), '2');
  assert.equal(f(1234567, '#,##0,"K"'), '1,235K');
});

test('百分比、常规、零值段、负数默认加负号、日期', () => {
  assert.equal(f(0.256, '0.0%'), '25.6%');
  assert.equal(f(0.5, '0%'), '50%');
  assert.equal(f(12, 'General"元"'), '12元');
  assert.equal(f(2.25, 'General'), '2.25');
  assert.equal(f(0, '0;-0;"-"'), '-');
  assert.equal(f(-3, '0'), '-3');
  assert.equal(f(45000, 'yyyy/m/d'), '2023/3/15');
});
