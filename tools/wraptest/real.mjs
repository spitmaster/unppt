// 自动换行专项测试：真实课件。real.py 用 PowerPoint 读出的每个文本框的每一行在 .cache/wraptest/real/<编号>.json；
// 这里转码后从产物还原每一行，逐行比。课件内容只在本机：输出只有数字，不一致的明细写到 .cache/wt-real.json（gitignore）。
// 用法：node tools/wraptest/real.mjs [份数，默认 100] [--from N] [--system-fonts] [--dist 构建目录]
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { textsByShape, linesOf, norm, systemFontBytes } from './lines.mjs';

const args = process.argv.slice(2);
const count = Number(args.find((a) => /^\d+$/.test(a)) ?? 100);
const from = args.includes('--from') ? Number(args[args.indexOf('--from') + 1]) : 0;
const systemFonts = args.includes('--system-fonts');
// --dist <目录>：用别的构建（比如旧版本）比，默认 packages/transcoder/dist
const dist = args.includes('--dist') ? args[args.indexOf('--dist') + 1] : 'packages/transcoder/dist';
const { convert } = await import(pathToFileURL(join(dist, 'index.js')).href);
const { loadFontPack } = await import(pathToFileURL(join(dist, 'node.js')).href);
const fonts = systemFonts ? await systemFontBytes() : [];
const fontPack = systemFonts ? undefined : await loadFontPack();

const index = JSON.parse(await readFile('.cache/samples.json', 'utf8'));
const hashes = Object.keys(index).filter((h) => index[h].present && existsSync(`.cache/wraptest/real/${h}.json`)).sort().slice(from, from + count);

/** real.py 存的形状树 -> 有行信息的形状（组合展开） */
function flatten(shapes, out = []) {
  for (const s of shapes ?? []) {
    if (s.children) flatten(s.children, out);
    else if (s.lines?.length && !s.lines.some((l) => l.error)) out.push(s);
  }
  return out;
}

let decks = 0, failed = 0, skipped = 0;
const stat = { box: [0, 0, 0, 0], cell: [0, 0, 0, 0] };
const all = [];
for (const h of hashes) {
  const ref = JSON.parse(await readFile(`.cache/ref/${h}/ref.json`, 'utf8'));
  const lines = JSON.parse(await readFile(`.cache/wraptest/real/${h}.json`, 'utf8'));
  const tables = existsSync(`.cache/wraptest/real/${h}.tables.json`) ? JSON.parse(await readFile(`.cache/wraptest/real/${h}.tables.json`, 'utf8')) : undefined;
  const src = ref.converted ? `.cache/ref/${h}/converted.pptx` : join(index[h].paths[0]);
  let deck = '';
  let res;
  try {
    res = await convert(new Uint8Array(await readFile(src)), {
      output: 'data', images: false, embedFonts: false, fonts, fontPack,
      write: async (path, data) => {
        if (path !== 'deck.json') return;
        if (typeof data === 'string') deck += data;
        else if (data instanceof Uint8Array) deck += new TextDecoder().decode(data);
        else for await (const c of data) deck += typeof c === 'string' ? c : new TextDecoder().decode(c);
      },
    });
  } catch {
    failed++;
    continue;
  }
  decks++;
  const slides = JSON.parse(deck).slides;
  // 这台电脑上没有的字体（没嵌入、度量包里也没有）：PowerPoint 在这里排版用的是它自己的替代字体，作者电脑上不是这样排的，不算
  const noFont = new Set(res.fontCheck?.fonts.filter((f) => f.status === 'substituted' || f.status === 'missing').flatMap((f) => f.pages) ?? []);
  for (const rs of lines.slides) {
    const svg = slides[rs.index]?.svg;
    if (!svg) continue;
    if (noFont.has(rs.index + 1)) { skipped++; continue; }
    const ours = textsByShape(svg);
    for (const s of flatten(rs.shapes)) {
      compare('box', s.lines.map((l) => l.text), linesOf(ours.get(String(s.id)) ?? []), { deck: h, slide: rs.index + 1, id: s.id, w: s.w });
    }
    // 表格：每个单元格按文字找到我们的单元格（产物里每个单元格的文字在一个平移组里）
    for (const c of tables?.cells.filter((x) => x.slide === rs.index) ?? []) {
      const groups = new Map();
      for (const it of ours.get(String(c.id)) ?? []) groups.set(it.cell, [...groups.get(it.cell) ?? [], it]);
      const wantText = c.lines.map(norm).join('');
      const mine = [...groups.values()].map((g) => linesOf(g)).filter((g) => g.map(norm).join('') === wantText);
      if (mine.length === 1) compare('cell', c.lines, mine[0], { deck: h, slide: rs.index + 1, id: c.id, r: c.r, c: c.c });
    }
  }
}

/** 一个文本框 / 单元格：PowerPoint 的行和我们的行比 */
function compare(kind, pptLines, ourLines, info) {
  const want = pptLines.map(norm).filter((l) => l);
  const got = ourLines.map(norm).filter((l) => l);
  // 只看多行的（一行的不涉及换行）；文字对不上（竖排、艺术字、我们没画出来的等）不算换行问题
  if (want.length < 2 && got.length < 2) return;
  if (want.join('') !== got.join('')) return;
  const st = stat[kind];
  st[0]++;
  st[2] += want.length;
  let diff = 0;
  for (let i = 0; i < Math.max(want.length, got.length); i++) if (want[i] !== got[i]) diff++;
  if (diff) {
    st[1]++;
    st[3] += diff;
    all.push({ kind, ...info, want, got });
  }
}
await writeFile('.cache/wt-real.json', JSON.stringify(all, null, 1));
const pct = (st) => `${st[0]} 个，换行完全一致 ${st[0] - st[1]} 个（${((1 - st[1] / Math.max(1, st[0])) * 100).toFixed(1)}%）；行 ${st[2]} 行，不一致 ${st[3]} 行`;
console.log(`${systemFonts ? '本机字体' : '默认字体包'}：课件 ${decks} 份（转码失败 ${failed}，有本机没有的字体、不比的页 ${skipped}）`);
console.log(`  多行文本框 ${pct(stat.box)}`);
console.log(`  多行表格单元格 ${pct(stat.cell)}`);
