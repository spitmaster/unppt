// 自动换行专项测试：用转码器转 gen.py 生成的用例，从产物里还原每个文本框的每一行，和 PowerPoint 的逐行比对。
// 用法：node tools/wraptest/check.mjs <种子>[,<种子>…] [--system-fonts] [--show N]
//   默认用默认字体包（产品默认行为）；--system-fonts 用本机字体（量规则用）；--show 列出前 N 个不一致的文本框
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { convert } from '../../packages/transcoder/dist/index.js';
import { loadFontPack } from '../../packages/transcoder/dist/node.js';

const args = process.argv.slice(2);
const seeds = args[0].split(',');
const systemFonts = args.includes('--system-fonts');
const show = Number(args[args.indexOf('--show') + 1]) || (args.includes('--show') ? 20 : 0);
const dump = args.includes('--dump') ? args[args.indexOf('--dump') + 1] : undefined;
const all = [];

async function listFonts(dir, out = []) {
  let ents;
  try { ents = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await listFonts(p, out);
    else if (/\.(ttf|otf|ttc)$/i.test(e.name)) out.push(p);
  }
  return out;
}
const local = process.env.LOCALAPPDATA ?? '';
const fonts = systemFonts
  ? await Promise.all((await Promise.all(['C:/Windows/Fonts', join(local, 'Microsoft/Windows/Fonts'), join(local, 'Microsoft/FontCache/4/CloudFonts')].map((d) => listFonts(d)))).flat()
    .map(async (f) => new Uint8Array(await readFile(f))))
  : [];
const fontPack = systemFonts ? undefined : await loadFontPack();

const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');

/** 页面 SVG -> 每个形状（编号）的文字元素：{ x, y, size, text } */
function textsByShape(svg) {
  const out = new Map();
  const stack = [];
  const re = /<g\b([^>]*)>|<\/g>|<text\b([^>]*)>([\s\S]*?)<\/text>/g;
  let m;
  while ((m = re.exec(svg))) {
    if (m[0].startsWith('</g')) { stack.pop(); continue; }
    if (m[1] !== undefined) { const u = /data-uid="s(\d+)p\d+"/.exec(m[1]) ?? /data-uid="s(\d+)"/.exec(m[1]); stack.push(u ? u[1] : undefined); continue; }
    const attrs = m[2];
    if (/data-bu="1"/.test(attrs)) continue;
    const shape = [...stack].reverse().find((v) => v !== undefined);
    if (!shape) continue;
    const xs = /\bx="([^"]*)"/.exec(attrs)?.[1].split(' ').map(Number) ?? [0];
    const ys = /\by="([^"]*)"/.exec(attrs)?.[1].split(' ').map(Number) ?? [0];
    const size = Number(/font-size="([^"]*)"/.exec(attrs)?.[1] ?? 12);
    const text = unesc(m[3].replace(/<[^>]+>/g, ''));
    let list = out.get(shape);
    if (!list) { list = []; out.set(shape, list); }
    list.push({ x: xs[0], y: Math.max(...ys), size, text });
  }
  return out;
}

/** 文字元素按基线分行：基线相差不到半个字号算同一行，行内按横坐标排 */
function linesOf(items) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    const cur = lines[lines.length - 1];
    if (cur && Math.abs(it.y - cur.y) < Math.max(3, it.size * 0.4)) cur.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  return lines.map((l) => l.items.sort((a, b) => a.x - b.x).map((i) => i.text).join(''));
}

// 比较时去掉所有空白：两端、分散对齐时空格单独成段、不出文字元素，空格不影响在哪个字换行
const norm = (s) => s.replace(/[\s\u000b　]/gu, '');

let total = 0, bad = 0, lineTotal = 0, lineBad = 0;
const shown = [];
for (const seed of seeds) {
  const exp = JSON.parse(await readFile(`.cache/wraptest/${seed}.json`, 'utf8'));
  const input = new Uint8Array(await readFile(`.cache/wraptest/${seed}.pptx`));
  let deck = '';
  await convert(input, {
    output: 'data', images: false, embedFonts: false, fonts, fontPack,
    write: async (path, data) => {
      if (path !== 'deck.json') return;
      if (typeof data === 'string') deck += data;
      else if (data instanceof Uint8Array) deck += new TextDecoder().decode(data);
      else for await (const c of data) deck += typeof c === 'string' ? c : new TextDecoder().decode(c);
    },
  });
  const slides = JSON.parse(deck).slides;
  const perSlide = slides.map((s) => textsByShape(s.svg));
  for (const b of exp.boxes) {
    total++;
    const want = b.lines.map(norm).filter((l, i, a) => l || i < a.length - 1);
    const got = linesOf(perSlide[b.slide - 1].get(String(b.id)) ?? []).map(norm);
    // 空段落：PowerPoint 有空行，我们不出文字元素，比的时候去掉空行
    const w = want.filter((l) => l), g = got.filter((l) => l);
    lineTotal += w.length;
    let diff = 0;
    for (let i = 0; i < Math.max(w.length, g.length); i++) if (w[i] !== g[i]) diff++;
    if (diff) {
      bad++;
      lineBad += diff;
      all.push({ seed, slide: b.slide, id: b.id, font: b.font.join('/'), size: b.size, width: b.width, algn: b.algn, indent: b.indent, want: w, got: g });
      if (shown.length < show) shown.push({ seed, slide: b.slide, id: b.id, font: b.font.join('/'), size: b.size, width: b.width, algn: b.algn, indent: b.indent, want: w, got: g });
    }
  }
}
if (dump) await (await import('node:fs/promises')).writeFile(dump, JSON.stringify(all, null, 1));
console.log(`${systemFonts ? '本机字体' : '默认字体包'}：文本框 ${total} 个，换行完全一致 ${total - bad} 个（${((1 - bad / total) * 100).toFixed(1)}%）；行 ${lineTotal} 行，不一致 ${lineBad} 行`);
for (const s of shown) {
  console.log(`\n[种子 ${s.seed} 第 ${s.slide} 页 形状 ${s.id}] ${s.font} ${s.size} 磅 框宽 ${s.width} 磅 ${s.algn} ${s.indent}`);
  for (let i = 0; i < Math.max(s.want.length, s.got.length); i++) {
    const mark = s.want[i] === s.got[i] ? '  ' : '✗ ';
    console.log(`  ${mark}PPT：${s.want[i] ?? '（无）'}`);
    if (s.want[i] !== s.got[i]) console.log(`    我们：${s.got[i] ?? '（无）'}`);
  }
}
