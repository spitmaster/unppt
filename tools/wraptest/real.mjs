// 自动换行专项测试：真实课件。real.py 用 PowerPoint 读出的每个文本框的每一行在 .cache/wraptest/real/<编号>.json；
// 这里转码后从产物还原每一行，逐行比。课件内容只在本机：输出只有数字，不一致的明细写到 .cache/wt-real.json（gitignore）。
// 用法：node tools/wraptest/real.mjs [份数，默认 100] [--from N] [--system-fonts]
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { convert } from '../../packages/transcoder/dist/index.js';
import { loadFontPack } from '../../packages/transcoder/dist/node.js';
import { textsByShape, linesOf, norm, systemFontBytes } from './lines.mjs';

const args = process.argv.slice(2);
const count = Number(args.find((a) => /^\d+$/.test(a)) ?? 100);
const from = args.includes('--from') ? Number(args[args.indexOf('--from') + 1]) : 0;
const systemFonts = args.includes('--system-fonts');
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

let decks = 0, failed = 0, total = 0, bad = 0, lineTotal = 0, lineBad = 0;
const all = [];
for (const h of hashes) {
  const ref = JSON.parse(await readFile(`.cache/ref/${h}/ref.json`, 'utf8'));
  const lines = JSON.parse(await readFile(`.cache/wraptest/real/${h}.json`, 'utf8'));
  const src = ref.converted ? `.cache/ref/${h}/converted.pptx` : join(index[h].paths[0]);
  let deck = '';
  try {
    await convert(new Uint8Array(await readFile(src)), {
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
  for (const rs of lines.slides) {
    const svg = slides[rs.index]?.svg;
    if (!svg) continue;
    const ours = textsByShape(svg);
    for (const s of flatten(rs.shapes)) {
      const want = s.lines.map((l) => norm(l.text)).filter((l) => l);
      const got = linesOf(ours.get(String(s.id)) ?? []).map(norm).filter((l) => l);
      // 只看多行的（一行的不涉及换行）
      if (want.length < 2 && got.length < 2) continue;
      // 文字对不上（竖排、艺术字、我们没画出来的等）不算换行问题
      if (want.join('') !== got.join('')) continue;
      total++;
      lineTotal += want.length;
      let diff = 0;
      for (let i = 0; i < Math.max(want.length, got.length); i++) if (want[i] !== got[i]) diff++;
      if (diff) {
        bad++;
        lineBad += diff;
        all.push({ deck: h, slide: rs.index + 1, id: s.id, w: s.w, want, got });
      }
    }
  }
}
await writeFile('.cache/wt-real.json', JSON.stringify(all, null, 1));
console.log(`${systemFonts ? '本机字体' : '默认字体包'}：课件 ${decks} 份（转码失败 ${failed}），多行文本框 ${total} 个，换行完全一致 ${total - bad} 个（${((1 - bad / Math.max(1, total)) * 100).toFixed(1)}%）；行 ${lineTotal} 行，不一致 ${lineBad} 行`);
