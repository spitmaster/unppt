// 自动换行专项测试：用转码器转 gen.py 生成的用例，从产物里还原每个文本框的每一行，和 PowerPoint 的逐行比对。
// 表格用例（gen_table.py）按单元格比。
// 用法：node tools/wraptest/check.mjs <种子>[,<种子>…] [--system-fonts] [--show N]
//   默认用默认字体包（产品默认行为）；--system-fonts 用本机字体（量规则用）；--show 列出前 N 个不一致的文本框
import { readFile } from 'node:fs/promises';
import { convert } from '../../packages/transcoder/dist/index.js';
import { loadFontPack } from '../../packages/transcoder/dist/node.js';
import { textsByShape, linesOf, norm, systemFontBytes } from './lines.mjs';

const args = process.argv.slice(2);
const seeds = args[0].split(',');
const systemFonts = args.includes('--system-fonts');
const show = args.includes('--show') ? Number(args[args.indexOf('--show') + 1]) || 20 : 0;
const dump = args.includes('--dump') ? args[args.indexOf('--dump') + 1] : undefined;
const all = [];
const fonts = systemFonts ? await systemFontBytes() : [];
const fontPack = systemFonts ? undefined : await loadFontPack();

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
  // 表格（gen_table.py）：每个单元格按文字找到我们的单元格（产物里每个单元格的文字在一个平移组里）
  const cellLines = (c) => {
    const groups = new Map();
    for (const it of perSlide[c.slide - 1].get(String(c.id)) ?? []) groups.set(it.cell, [...groups.get(it.cell) ?? [], it]);
    const want = c.lines.map(norm).join('');
    const mine = [...groups.values()].map((g) => linesOf(g)).filter((g) => g.map(norm).join('') === want);
    return mine.length === 1 ? mine[0] : [];
  };
  const entries = exp.boxes
    ? exp.boxes.map((b) => [b, linesOf(perSlide[b.slide - 1].get(String(b.id)) ?? [])])
    : exp.cells.map((c) => [{ ...c, algn: '', indent: `第 ${c.r} 行第 ${c.c} 列` }, cellLines(c)]);
  for (const [b, ours] of entries) {
    total++;
    const want = b.lines.map(norm).filter((l, i, a) => l || i < a.length - 1);
    const got = ours.map(norm);
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
