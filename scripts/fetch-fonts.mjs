// 按 packages/fonts/fonts.json 下载默认字体包的字体文件到 packages/fonts/files/，校验 SHA-256（已有且校验对的跳过）。
// 写了 path 的是仓库里生成好的字体（符号字体的兼容字体，tools/fonts/build-symbol-compat.py），从 packages/fonts/<path> 复制过去。
// 字体文件不进 git 仓库（太大），开发前和发布前各运行一次：node scripts/fetch-fonts.mjs
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { BlobReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';

const root = new URL('../packages/fonts/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('fonts.json', root), 'utf8'));
const dir = new URL('files/', root);
await mkdir(dir, { recursive: true });
const sha = (b) => createHash('sha256').update(b).digest('hex');
const downloads = new Map();
const download = (url) => {
  let p = downloads.get(url);
  if (!p) {
    p = (async () => {
      for (let i = 0; i < 3; i++) {
        try {
          const r = await fetch(url, { redirect: 'follow' });
          if (r.ok) return new Uint8Array(await r.arrayBuffer());
        } catch { /* 重试 */ }
      }
      throw new Error(`下载失败：${url}`);
    })();
    downloads.set(url, p);
  }
  return p;
};

/** tar 包里取一个文件 */
function fromTar(tar, path) {
  for (let o = 0; o + 512 <= tar.length;) {
    const name = new TextDecoder().decode(tar.subarray(o, o + 100)).replace(/\0.*$/s, '');
    if (!name) break;
    const size = parseInt(new TextDecoder().decode(tar.subarray(o + 124, o + 136)).replace(/\0.*$/s, '').trim(), 8) || 0;
    if (name === path) return tar.subarray(o + 512, o + 512 + size);
    o += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error(`压缩包里没有 ${path}`);
}

async function fromZip(zip, path) {
  const reader = new ZipReader(new BlobReader(new Blob([zip])));
  const entry = (await reader.getEntries()).find((e) => e.filename === path);
  if (!entry) throw new Error(`压缩包里没有 ${path}`);
  const data = await entry.getData(new Uint8ArrayWriter());
  await reader.close();
  return data;
}

let fetched = 0;
for (const f of manifest.files) {
  const target = new URL(f.file, dir);
  try {
    if (sha(await readFile(target)) === f.sha256) continue;
  } catch { /* 没有这个文件 */ }
  if (f.path) {
    const data = await readFile(new URL(f.path, root));
    if (sha(data) !== f.sha256) throw new Error(`${f.path} 校验不对（重新生成后要更新 fonts.json）`);
    await writeFile(target, data);
    fetched++;
    continue;
  }
  const raw = await download(f.url);
  const data = !f.archivePath ? raw : f.url.endsWith('.zip') ? await fromZip(raw, f.archivePath) : fromTar(gunzipSync(raw), f.archivePath);
  if (sha(data) !== f.sha256) throw new Error(`${f.file} 校验不对（来源可能变了）：${f.url}`);
  await writeFile(target, data);
  fetched++;
  console.log(`下载 ${f.file}`);
}
console.log(`字体文件 ${manifest.files.length} 个就绪（本次下载 ${fetched} 个）：${fileURLToPath(dir)}`);
