// 发布演示站：把 .cache/site（先跑 node site/build.mjs）整个放进 gh-pages 分支并推送，GitHub Pages 从这个分支提供服务。
// 用法：node site/publish.mjs [--no-push]。gh-pages 分支只放构建出来的静态文件，和源码分支没有共同历史。
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const site = join(root, '.cache', 'site');
const wt = join(root, '.cache', 'gh-pages');
const git = (args, cwd = root) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();

if (!existsSync(join(site, 'index.html'))) throw new Error('先运行 node site/build.mjs');
if (!existsSync(wt)) {
  const remote = git(['ls-remote', '--heads', 'origin', 'gh-pages']);
  if (remote) {
    git(['fetch', 'origin', 'gh-pages:gh-pages']);
    git(['worktree', 'add', wt, 'gh-pages']);
  } else {
    git(['worktree', 'add', '--orphan', '-b', 'gh-pages', wt]);
  }
}
for (const f of readdirSync(wt)) if (f !== '.git') rmSync(join(wt, f), { recursive: true, force: true });
cpSync(site, wt, { recursive: true });
git(['add', '-A'], wt);
if (!git(['status', '--porcelain'], wt)) { console.log('没有变化'); process.exit(0); }
const head = git(['rev-parse', '--short', 'HEAD']);
git(['commit', '-q', '-m', `site: 演示站（源码 ${head}）`], wt);
if (!process.argv.includes('--no-push')) git(['push', '-q', '-u', 'origin', 'gh-pages'], wt);
console.log('已发布 gh-pages');
