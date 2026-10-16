// 相邻、同一个文字效果滤镜的 <text> 收进一组（两端对齐时中文每个字单独一段，不能每个字各做一遍滤镜）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const r = await build({ entryPoints: ['packages/transcoder/src/text/emit.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], logLevel: 'silent' });
const { groupFilters } = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));

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
