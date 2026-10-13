// 架构守门：循环依赖和分层规则（规则在 scripts/check-deps.mjs）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('源码没有循环依赖，满足分层规则', () => {
  const r = spawnSync(process.execPath, ['scripts/check-deps.mjs'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});
