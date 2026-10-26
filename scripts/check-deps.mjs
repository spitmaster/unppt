/**
 * 架构守门：检查源码的 import 关系。
 *   1. 不允许循环依赖；
 *   2. 分层规则（下层不能依赖上层），规则见 RULES；
 *   3. 播放器和转码器互不依赖，只通过 @unppt/format 交流。
 * 用法：node scripts/check-deps.mjs（有问题时以非 0 退出）。也作为 npm test 的一部分运行。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 每个模块（目录）允许依赖的模块。key 是相对 packages/ 的目录；值里没列的都不允许。
 * 转码器从低到高：io → common → model → geometry / font → style → effects → text → media → chart / smartart → render → anim → 入口
 */
const T = 'transcoder/src/';
const RULES = {
  'format/src': [],
  'player/src': ['format/src'],
  [`${T}io`]: [],
  [`${T}common`]: [`${T}io`],
  [`${T}model`]: [`${T}io`, `${T}common`],
  [`${T}geometry`]: [`${T}io`, `${T}common`],
  [`${T}font`]: [`${T}io`, `${T}common`],
  [`${T}style`]: [`${T}io`, `${T}common`, `${T}model`],
  [`${T}effects`]: [`${T}io`, `${T}common`, `${T}model`],
  [`${T}text`]: [`${T}io`, `${T}common`, `${T}model`, `${T}geometry`, `${T}font`, `${T}style`, `${T}effects`],
  [`${T}media`]: [`${T}io`, `${T}common`, `${T}model`],
  [`${T}chart`]: [`${T}io`, `${T}common`, `${T}model`, `${T}font`, `${T}style`],
  [`${T}smartart`]: [`${T}io`, `${T}common`, `${T}model`],
  [`${T}render`]: [`${T}io`, `${T}common`, `${T}model`, `${T}geometry`, `${T}font`, `${T}style`, `${T}effects`, `${T}text`, `${T}media`, `${T}chart`, `${T}smartart`],
  [`${T}anim`]: [`${T}io`, `${T}common`, `${T}model`, 'format/src'],
  [`${T}output`]: [`${T}io`, `${T}common`, `${T}media`, 'format/src'],
  [`${T}preview`]: [`${T}io`, `${T}common`, `${T}media`, `${T}font`],
  'transcoder/src': ['*'],
};

const files = [];
const walk = (d) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.ts') && !p.endsWith('.d.ts')) files.push(p);
  }
};
for (const pkg of ['format', 'player', 'transcoder']) walk(join(root, 'packages', pkg, 'src'));

const rel = (p) => relative(join(root, 'packages'), p).replace(/\\/g, '/');
/** 文件属于哪个模块：规则表里最长的匹配目录 */
const moduleOf = (file) => {
  const dir = rel(dirname(file));
  let best = '';
  for (const k of Object.keys(RULES)) if ((dir === k || dir.startsWith(k + '/')) && k.length > best.length) best = k;
  return best;
};

const graph = new Map();
const problems = [];
const importRe = /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s+['"](\.{1,2}\/[^'"]+)['"]/g;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const deps = [];
  for (const m of src.matchAll(importRe)) {
    let target = resolve(dirname(f), m[1]);
    if (!target.endsWith('.ts')) target += '.ts';
    deps.push(target);
    const from = moduleOf(f), to = moduleOf(target);
    if (from === to) continue;
    const allowed = RULES[from] ?? [];
    if (!allowed.includes('*') && !allowed.includes(to)) problems.push(`分层违规：${rel(f)} -> ${rel(target)}（${from} 不能依赖 ${to || '?'}）`);
  }
  graph.set(f, deps);
}

// 循环依赖（深度优先找环）
const state = new Map();
const stack = [];
const cycles = new Set();
const dfs = (f) => {
  state.set(f, 1);
  stack.push(f);
  for (const d of graph.get(f) ?? []) {
    if (!graph.has(d)) continue;
    if (state.get(d) === 1) cycles.add(stack.slice(stack.indexOf(d)).concat(d).map(rel).join(' -> '));
    else if (!state.get(d)) dfs(d);
  }
  stack.pop();
  state.set(f, 2);
};
for (const f of graph.keys()) if (!state.get(f)) dfs(f);
for (const c of cycles) problems.push(`循环依赖：${c}`);

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`依赖检查通过：${files.length} 个文件，无循环依赖，分层规则全部满足`);
