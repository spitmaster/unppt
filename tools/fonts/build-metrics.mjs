// 字体度量包：从本机的 Windows / Office 字体里只取排版用的数字（字宽、上下伸、行间距、删除线、x 高度、字距调整），
// 不取字形。转码时按原字体的字宽排版、用开源字体显示（SPEC D3）。
// 用法：node tools/fonts/build-metrics.mjs [输出目录，默认 packages/fonts/metrics]
// 输出：index.json（每个字形一项：名字、粗斜体、字重、行高等）和 faces/<编号>.json（字宽区间、字距对，单位都是字体单位）
import { build } from 'esbuild';
import { readdir, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, basename } from 'node:path';

const r = await build({
  stdin: { contents: `export { loadFontFile } from './packages/transcoder/src/font/font.ts';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], logLevel: 'silent',
});
const { loadFontFile } = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));

const out = process.argv[2] ?? 'packages/fonts/metrics';
const local = process.env.LOCALAPPDATA ?? '';
const dirs = ['C:/Windows/Fonts', join(local, 'Microsoft/Windows/Fonts'), join(local, 'Microsoft/FontCache/4/CloudFonts')];

async function listFonts(d) {
  const res = [];
  let ents;
  try { ents = await readdir(d, { withFileTypes: true }); } catch { return res; }
  for (const e of ents) {
    const p = join(d, e.name);
    if (e.isDirectory()) res.push(...await listFonts(p));
    else if (/\.(ttf|ttc|otf)$/i.test(e.name)) res.push(p);
  }
  return res;
}

// 排版会问到的字：基本多文种平面全部 + 扩展 B 区（有的话）
const RANGES = [[0x20, 0xd7ff], [0xe000, 0xfffd], [0x20000, 0x2a6df]];
// 字距调整只记基本拉丁字母、数字、标点和空格之间的（中文字体基本没有字距数据；带重音的字母太多，数据量翻几倍，收益很小）。
// 空格不能少：Arial、Times New Roman 的 " A"、Gill Sans MT 的 " T" 都有字距，PowerPoint 照算（SPEC 第 7 节，Gallery 主题标题）
const KERN_SET = [];
for (let c = 0x20; c <= 0x7e; c++) KERN_SET.push(c);
KERN_SET.push(0x2018, 0x2019, 0x201c, 0x201d);

await rm(join(out, 'faces'), { recursive: true, force: true });
await mkdir(join(out, 'faces'), { recursive: true });
const index = [];
const seen = new Set();
const skipped = [];
for (const d of dirs) {
  for (const path of await listFonts(d)) {
    let faces;
    try { faces = await loadFontFile(new Uint8Array(await readFile(path))); } catch { continue; }
    for (const f of faces) {
      // 按全部名字去重：同一个排版家族里的窄体、标题体（Arial Narrow 的家族名也是 Arial，Aptos Display 的也是 Aptos）是不同的字体
      const key = `${[...f.families].sort().join('/')}|${f.bold}|${f.italic}|${f.weight}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let m;
      try { m = await f.load(); } catch { continue; }
      // 补字字体（只有扩展 A 区等生僻字，没有拉丁字母、也没有常用汉字，例如汉仪中黑 197）：不当成这个名字的字体，
      // 否则课件写这个名字时排版查不到常用字，退回宋体之类，字体检查却说没问题
      let extA = 0;
      for (let cp = 0x3400; cp <= 0x4dbf; cp++) if (m.advance(cp) !== undefined) extA++;
      if (m.advance(0x41) === undefined && m.advance(0x4e2d) === undefined && extA > 100) { skipped.push(f.families[0]); continue; }
      const upem = m.unitsPerEm;
      const runs = [];
      let cjk = 0;
      for (const [a, b] of RANGES) {
        if (a === 0x20000 && m.advance(0x20000) === undefined && m.advance(0x2000b) === undefined) continue;
        let cur;
        for (let cp = a; cp <= b; cp++) {
          const w = m.advance(cp);
          if (w === undefined) { cur = undefined; continue; }
          const u = Math.round(w * upem);
          if (cp >= 0x4e00 && cp <= 0x9fff) cjk++;
          if (cur && cur[0] + cur[1] === cp && cur[2] === u) cur[1]++;
          else { cur = [cp, 1, u]; runs.push(cur); }
        }
      }
      const present = KERN_SET.filter((c) => m.advance(c) !== undefined);
      const kern = [];
      for (const a of present) for (const b of present) {
        const v = Math.round(m.kern(a, b) * upem);
        if (v) kern.push([a, b, v]);
      }
      // 汉字的竖直中心（显示字体的汉字按它对齐，见 font/pack.ts）：几个方正汉字字形上下范围的中点的平均
      let cjkMid;
      if (cjk > 1000) {
        const mids = [];
        for (const ch of '中国口田日') {
          const cs = await m.outline(ch.codePointAt(0)).catch(() => undefined);
          const ys = (cs ?? []).flat().map((p) => p.y);
          if (ys.length) mids.push((Math.min(...ys) + Math.max(...ys)) / 2);
        }
        if (mids.length) cjkMid = Math.round((mids.reduce((a, b) => a + b, 0) / mids.length) * upem);
      }
      const id = String(index.length);
      const r2 = (v) => (v === undefined ? undefined : Math.round(v * upem));
      index.push({
        id, families: f.families, display: f.displayFamily, bold: f.bold, italic: f.italic, weight: f.weight,
        upem, ascent: r2(m.ascent), descent: r2(m.descent), lineGap: r2(m.lineGap),
        ...(r2(m.extLeading) ? { extLead: r2(m.extLeading) } : {}), ...(m.eastAsian ? { ea: true } : {}),
        strikeTop: r2(m.strikeTop), strikeSize: r2(m.strikeSize), xHeight: r2(m.xHeight), generic: m.generic,
        cjk: cjk > 1000, ...(cjkMid !== undefined ? { cjkMid } : {}), file: basename(path),
      });
      await writeFile(join(out, 'faces', `${id}.json`), JSON.stringify({ runs, kern }));
    }
  }
}
await writeFile(join(out, 'index.json'), JSON.stringify(index));
console.log(`${index.length} 个字形${skipped.length ? `，跳过补字字体：${skipped.join('、')}` : ''}`);
