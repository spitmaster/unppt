/**
 * Node 里读默认字体包 @unppt/fonts（SPEC D3）：度量包 metrics/、显示用的开源字体 files/、对照规则 map.json。
 * 转码器本身不碰文件系统（D2），由这里把字体包变成 convert() 的 fontPack 选项。
 */
import { open, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FontPack, PackFaceData, PackFaceInfo, PackRule, RandomAccessSource } from './index';

/** 按位置读文件的片段（每次读都单独打开、关闭，字体只在嵌入和建索引时读几次） */
function fileSource(path: string, size: number): RandomAccessSource {
  return {
    size,
    async read(offset, length) {
      const h = await open(path, 'r');
      try {
        const buf = new Uint8Array(Math.max(0, Math.min(length, size - offset)));
        let got = 0;
        while (got < buf.length) {
          const { bytesRead } = await h.read(buf, got, buf.length - got, offset + got);
          if (!bytesRead) break;
          got += bytesRead;
        }
        return got === buf.length ? buf : buf.subarray(0, got);
      } finally {
        await h.close();
      }
    },
  };
}

/** 找字体包目录：装了 @unppt/fonts 用它；仓库里开发时用 packages/fonts */
export function findFontPackDir(): string | undefined {
  try {
    const dir = dirname(fileURLToPath(import.meta.resolve('@unppt/fonts')));
    if (existsSync(join(dir, 'map.json'))) return dir;
  } catch { /* 没装 */ }
  const dev = fileURLToPath(new URL('../../fonts/', import.meta.url));
  return existsSync(join(dev, 'map.json')) ? dev : undefined;
}

/** 读字体包；找不到时返回 undefined（转码照常进行，没有字体文件的字宽只能估算） */
export async function loadFontPack(dir = findFontPackDir()): Promise<FontPack | undefined> {
  if (!dir || !existsSync(join(dir, 'map.json'))) return undefined;
  const faces = JSON.parse(await readFile(join(dir, 'metrics', 'index.json'), 'utf8')) as PackFaceInfo[];
  const rules = (JSON.parse(await readFile(join(dir, 'map.json'), 'utf8')) as { rules: PackRule[] }).rules;
  const sizes = new Map<string, number>();
  const manifest = JSON.parse(await readFile(join(dir, 'fonts.json'), 'utf8')) as { files: { file: string }[] };
  for (const f of manifest.files) {
    const p = join(dir, 'files', f.file);
    try { sizes.set(f.file, (await stat(p)).size); } catch { /* 字体文件没下载（scripts/fetch-fonts.mjs） */ }
  }
  return {
    faces, rules,
    async metrics(id) {
      return JSON.parse(await readFile(join(dir, 'metrics', 'faces', `${id}.json`), 'utf8')) as PackFaceData;
    },
    file(name) {
      const size = sizes.get(name);
      return size === undefined ? undefined : fileSource(join(dir, 'files', name), size);
    },
  };
}
