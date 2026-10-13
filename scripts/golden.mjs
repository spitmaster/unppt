/**
 * 重构安全网：把 testcases/ 里所有用例转码，记录每个输出文件的哈希。
 *   node scripts/golden.mjs save    记录当前输出为基准（.cache/golden.json）
 *   node scripts/golden.mjs check   和基准比较，有任何不同就列出来并以非 0 退出
 * 重构（不该改变行为的改动）必须 check 通过。
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const cases = join(root, 'testcases');
const out = join(root, '.cache', 'golden-out');
const file = join(root, '.cache', 'golden.json');
const mode = process.argv[2] ?? 'check';

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const hashes = {};
const hashDir = (dir, prefix) => {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) hashDir(p, `${prefix}${name.name}/`);
    else hashes[`${prefix}${name.name}`] = createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16);
  }
};
for (const f of readdirSync(cases).filter((n) => n.endsWith('.pptx')).sort()) {
  const name = f.replace(/\.pptx$/, '');
  for (const [suffix, args] of [['html', []], ['data', ['--data']]]) {
    const dir = join(out, `${name}.${suffix}`);
    mkdirSync(dir, { recursive: true });
    const target = join(dir, suffix === 'html' ? 'index.html' : 'deck.json');
    execFileSync('node', [join(root, 'packages/transcoder/dist/cli.js'), 'convert', join(cases, f), '-o', target, '-q', '--system-fonts', ...args], { stdio: 'inherit' });
  }
}
hashDir(out, '');

if (mode === 'save') {
  writeFileSync(file, JSON.stringify(hashes, null, 1));
  console.log(`基准已记录：${Object.keys(hashes).length} 个输出文件`);
} else {
  if (!existsSync(file)) { console.error('还没有基准，先运行 node scripts/golden.mjs save'); process.exit(2); }
  const base = JSON.parse(readFileSync(file, 'utf8'));
  const diff = [...new Set([...Object.keys(base), ...Object.keys(hashes)])].filter((k) => base[k] !== hashes[k]);
  if (diff.length) {
    console.error(`输出有 ${diff.length} 处不同：`);
    for (const k of diff.slice(0, 30)) console.error('  ' + k);
    process.exit(1);
  }
  console.log(`输出和基准完全一致（${Object.keys(hashes).length} 个文件）`);
}
