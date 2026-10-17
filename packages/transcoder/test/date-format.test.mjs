// 图表的日期 / 时间格式（chart/date-format.ts，经 formatNumber 调用；源码用 esbuild 现场打包后测试）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const r = await build({ entryPoints: ['packages/transcoder/src/chart/format.ts'], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { formatNumber } = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));

const SEP_1_2020 = 44075;          // 2020-09-01
const NOON = 44075.5 + 5 / 1440;    // 2020-09-01 12:05

test('引号里的汉字照写', () => {
  assert.equal(formatNumber(SEP_1_2020, 'yyyy"年"m"月"'), '2020年9月');
  assert.equal(formatNumber(SEP_1_2020, 'yyyy"年"m"月"d"日"'), '2020年9月1日');
  assert.equal(formatNumber(SEP_1_2020, '[$-804]yyyy"年"m"月"'), '2020年9月');
});

test('系统短日期（内置 14 号）按中文系统显示成 年/月/日', () => {
  assert.equal(formatNumber(SEP_1_2020, 'm/d/yyyy'), '2020/9/1');
});

test('补零、两位年份、英文月名', () => {
  assert.equal(formatNumber(SEP_1_2020, 'yyyy-mm-dd'), '2020-09-01');
  assert.equal(formatNumber(SEP_1_2020, 'yy/m/d'), '20/9/1');
  assert.equal(formatNumber(SEP_1_2020, 'mmm-yy'), 'Sep-20');
  assert.equal(formatNumber(SEP_1_2020, 'mmmm'), 'September');
});

test('时间：h 后面、s 前面的 m 是分钟', () => {
  assert.equal(formatNumber(NOON, 'h:mm'), '12:05');
  assert.equal(formatNumber(NOON, 'h:mm AM/PM'), '12:05 PM');
  assert.equal(formatNumber(NOON, 'yyyy/m/d hh:mm'), '2020/9/1 12:05');
});

test('数字格式不受影响', () => {
  assert.equal(formatNumber(0.567, '0%'), '57%');
  assert.equal(formatNumber(1234.5, '#,##0.0'), '1,234.5');
});
