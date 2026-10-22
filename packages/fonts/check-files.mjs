// 打包、发布前检查（npm pack / publish 的 prepack）：fonts.json 列的字体文件都在 files/ 里，大小、SHA-256 都对。
// 字体文件不在 git 里，忘了先运行 node scripts/fetch-fonts.mjs 时直接失败，不发出一个没有字体的包
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const { files } = JSON.parse(await readFile(join(dir, 'fonts.json'), 'utf8'));
const bad = [];
for (const f of files) {
  let data;
  try { data = await readFile(join(dir, 'files', f.file)); } catch { bad.push(`${f.file}：没有这个文件`); continue; }
  if (data.length !== f.size) bad.push(`${f.file}：大小 ${data.length}，应为 ${f.size}`);
  else if (createHash('sha256').update(data).digest('hex') !== f.sha256) bad.push(`${f.file}：SHA-256 不对`);
}
if (bad.length) {
  console.error(`字体包不完整（先在仓库根目录运行 node scripts/fetch-fonts.mjs）：\n  ${bad.join('\n  ')}`);
  process.exit(1);
}
console.log(`字体文件齐全：${files.length} 个`);
