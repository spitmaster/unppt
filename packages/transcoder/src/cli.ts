#!/usr/bin/env node
/**
 * 命令行：unppt convert <输入.pptx> [-o 输出.html] [--fonts 目录]... [--system-fonts] [--output 形式] [--inline-limit 字节]
 *
 * 这一层负责读写文件；转码本身（convert）不碰文件系统。
 */
import { open, mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { homedir, platform } from 'node:os';
import { convert, UNPPT_VERSION, type RandomAccessSource, type WriteData } from './index';

/** 打开过的文件句柄统一登记，结束时显式关闭（Node 不允许句柄被垃圾回收时自动关闭） */
const openHandles: Promise<import('node:fs/promises').FileHandle>[] = [];

async function closeAll() {
  await Promise.all(openHandles.map(async (h) => (await h).close().catch(() => {})));
}

function fileSource(path: string, size: number): RandomAccessSource {
  let fh: Promise<import('node:fs/promises').FileHandle> | undefined;
  return {
    size,
    async read(offset, length) {
      if (!fh) { fh = open(path, 'r'); openHandles.push(fh); }
      const h = await fh;
      const buf = new Uint8Array(Math.max(0, Math.min(length, size - offset)));
      let got = 0;
      while (got < buf.length) {
        const { bytesRead } = await h.read(buf, got, buf.length - got, offset + got);
        if (!bytesRead) break;
        got += bytesRead;
      }
      return got === buf.length ? buf : buf.subarray(0, got);
    },
  };
}

async function listFonts(dir: string, out: string[] = []): Promise<string[]> {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await listFonts(p, out);
    else if (/\.(ttf|otf|ttc)$/i.test(e.name)) out.push(p);
  }
  return out;
}

/** 本机系统字体目录（装进了系统，本机浏览器也能用） */
function systemFontDirs(): string[] {
  const env = process.env;
  switch (platform()) {
    case 'win32': return [join(env.WINDIR ?? 'C:\\Windows', 'Fonts'), join(env.LOCALAPPDATA ?? '', 'Microsoft', 'Windows', 'Fonts')];
    case 'darwin': return ['/System/Library/Fonts', '/Library/Fonts', join(homedir(), 'Library/Fonts')];
    default: return ['/usr/share/fonts', '/usr/local/share/fonts', join(homedir(), '.fonts'), join(homedir(), '.local/share/fonts')];
  }
}

/**
 * Office 自带的私有字体和云字体缓存：PowerPoint 能用，但没装进系统，浏览器用不了，所以用到时要嵌入产物
 * （Aptos、Gill Sans MT、Tw Cen MT 等主题字体都在这里）
 */
function officeFontDirs(): string[] {
  const env = process.env;
  switch (platform()) {
    case 'win32': return [
      ...[env.ProgramFiles, env['ProgramFiles(x86)']].filter((p): p is string => !!p).map((p) => join(p, 'Microsoft Office', 'root', 'vfs', 'Fonts', 'private')),
      join(env.LOCALAPPDATA ?? '', 'Microsoft', 'FontCache', '4', 'CloudFonts'),
    ];
    case 'darwin': return ['/Applications/Microsoft PowerPoint.app/Contents/Resources/DFonts'];
    default: return [];
  }
}

async function writeTo(base: string, rel: string, data: WriteData) {
  const target = resolve(base, rel);
  await mkdir(dirname(target), { recursive: true });
  const ws = createWriteStream(target);
  let failed: Error | undefined;
  const done = new Promise<void>((ok, fail) => {
    ws.on('finish', () => ok());
    ws.on('error', (e) => { failed = e; fail(e); });
  });
  done.catch(() => {});
  const put = async (chunk: Uint8Array | string) => {
    if (failed) throw failed;
    if (!ws.write(chunk)) await new Promise<void>((ok) => ws.once('drain', ok));
  };
  if (typeof data === 'string' || data instanceof Uint8Array) await put(data);
  else for await (const c of data) await put(c);
  ws.end();
  await done;
}

function usage(): never {
  console.log(`unppt ${UNPPT_VERSION}
用法：unppt convert <输入.pptx> [-o 输出.html] [选项]

选项：
  -o, --out <文件>        输出文件，默认和输入同名的 .html（--data 时为 .json）；
                          paged / pages 形式下是输出目录（入口是目录里的 index.html），默认和输入同名的目录
  --output <形式>         产物形式：single（默认，一个自包含的 HTML）、paged（按需加载：入口 HTML + 每页单独的数据文件，
                          看当前页时预加载下一页）、pages（paged 再加每页一个独立的 HTML）、data（同 --data）
  --fonts <目录>          字体目录（可以写多次），用来按真实字宽排版
  --system-fonts          使用本机系统字体目录（另外 Office 自带的私有字体、云字体用到时嵌入产物）
  --embed-fonts           把用到的字做成字体子集嵌入（观看端无需安装字体；商业字体注意授权）
  --data                  只输出演示数据 deck.json（开发调试用）
  --thumbs                输出缩略图文件夹 thumbs/（默认不输出；缩略图功能暂缓，见 docs/todo/dev.md）
  --thumb-width <像素>    缩略图宽度，默认 320
  --inline-limit <字节>   小于这个大小的图片内联进 HTML，默认 2097152
  --stats                 结束时显示用时和峰值内存
  -q, --quiet             不显示进度`);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] !== 'convert' || !args[1]) usage();
  const input = resolve(args[1]);
  let out = '';
  const fontDirs: string[] = [];
  const privateDirs: string[] = [];
  let form = 'single';
  let thumbs: boolean | undefined;
  let thumbWidth: number | undefined;
  let embedFonts = false;
  let inlineLimit: number | undefined;
  let quiet = false;
  let stats = false;
  for (let i = 2; i < args.length; i++) {
    const a = args[i];
    if (a === '-o' || a === '--out') out = args[++i];
    else if (a === '--fonts') fontDirs.push(args[++i]);
    else if (a === '--system-fonts') { fontDirs.push(...systemFontDirs()); privateDirs.push(...officeFontDirs()); }
    else if (a === '--data') form = 'data';
    else if (a === '--output') form = args[++i];
    else if (a === '--thumbs') thumbs = true;
    else if (a === '--no-thumbs') thumbs = false;
    else if (a === '--thumb-width') thumbWidth = Number(args[++i]);
    else if (a === '--embed-fonts') embedFonts = true;
    else if (a === '--inline-limit') inlineLimit = Number(args[++i]);
    else if (a === '-q' || a === '--quiet') quiet = true;
    else if (a === '--stats') stats = true;
    else usage();
  }
  const dataOnly = form === 'data';
  // 按需加载的形式输出一个目录
  const dirForm = form === 'paged' || form === 'pages';
  if (!out) out = join(dirname(input), basename(input, extname(input)) + (dirForm ? '' : dataOnly ? '.json' : '.html'));
  out = resolve(out);
  if (dirForm) out = join(out, 'index.html');

  const st = await stat(input);
  const fontFiles = (await Promise.all(fontDirs.map((d) => listFonts(d)))).flat();
  const fonts = await Promise.all(fontFiles.map(async (f) => fileSource(f, (await stat(f)).size)));
  const privateFiles = (await Promise.all(privateDirs.map((d) => listFonts(d)))).flat();
  const privateFonts = await Promise.all(privateFiles.map(async (f) => fileSource(f, (await stat(f)).size)));
  const t0 = Date.now();
  let peak = 0;
  const sample = () => { peak = Math.max(peak, process.memoryUsage().rss); };
  const timer = stats ? setInterval(sample, 20) : undefined;
  const result = await convert(fileSource(input, st.size), {
    write: (rel, data) => writeTo(dirname(out), rel === 'index.html' || rel === 'deck.json' ? basename(out) : rel, data),
    fonts, privateFonts,
    output: form,
    thumbs, thumbWidth,
    // 缩略图光栅化用的 resvg：和 cli.js 放在一起的 resvg.wasm（读不到时缩略图退回 SVG）
    thumbWasm: readFile(new URL('./resvg.wasm', import.meta.url)).then((b) => new Uint8Array(b), () => undefined),
    embedFonts,
    fileName: dataOnly ? 'deck.json' : 'index.html',
    inlineLimit,
    onProgress: quiet ? undefined : (d, t) => process.stderr.write(`\r转码中 ${d}/${t} 页`),
  });
  if (timer) {
    clearInterval(timer);
    sample();
    console.log(`统计：${result.slides} 页，用时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒，峰值内存 ${(peak / 1024 / 1024).toFixed(0)} MB`);
  }
  if (!quiet) {
    process.stderr.write('\n');
    console.log(`完成：${result.slides} 页，用时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒 -> ${out}`);
    if (result.report.missingFonts.length) console.log(`缺少字体：${result.report.missingFonts.join('、')}`);
    for (const w of result.report.warnings) console.log(`提示：${w}`);
  }
}

main().then(closeAll, async (e) => {
  await closeAll();
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
