// 自动换行专项测试的公用部分：本机字体、从产物 SVG 还原每个形状的每一行
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

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

/** 本机字体（--system-fonts 量规则用）：Windows 字体目录、用户字体、Office 云字体 */
export async function systemFontBytes() {
  const local = process.env.LOCALAPPDATA ?? '';
  const dirs = ['C:/Windows/Fonts', join(local, 'Microsoft/Windows/Fonts'), join(local, 'Microsoft/FontCache/4/CloudFonts')];
  const files = (await Promise.all(dirs.map((d) => listFonts(d)))).flat();
  return Promise.all(files.map(async (f) => new Uint8Array(await readFile(f))));
}

const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');

/** 页面 SVG -> 每个形状（编号）的文字元素：{ x, y, size, text, cell }。cell 是形状下面前两层平移组的位置，
 * 表格里每个单元格的文字各在一个平移组里，用它把单元格分开 */
export function textsByShape(svg) {
  const out = new Map();
  const stack = [];
  const re = /<g\b([^>]*)>|<\/g>|<text\b([^>]*)>([\s\S]*?)<\/text>/g;
  let m;
  while ((m = re.exec(svg))) {
    if (m[0].startsWith('</g')) { stack.pop(); continue; }
    if (m[1] !== undefined) {
      const u = /data-uid="s(\d+)p\d+"/.exec(m[1]) ?? /data-uid="s(\d+)"/.exec(m[1]);
      stack.push({ uid: u?.[1], tr: /transform="translate\(([^)]*)\)"/.exec(m[1])?.[1] });
      continue;
    }
    const attrs = m[2];
    if (/data-bu="1"/.test(attrs)) continue;
    let at = stack.length - 1;
    while (at >= 0 && stack[at].uid === undefined) at--;
    if (at < 0) continue;
    const shape = stack[at].uid;
    let top = at;
    while (top > 0 && stack[top - 1].uid === shape) top--;
    const cell = stack.slice(top + 1).map((e) => e.tr).filter((t) => t !== undefined).slice(0, 2).join('/');
    const xs = /\bx="([^"]*)"/.exec(attrs)?.[1].split(' ').map(Number) ?? [0];
    const ys = /\by="([^"]*)"/.exec(attrs)?.[1].split(' ').map(Number) ?? [0];
    const size = Number(/font-size="([^"]*)"/.exec(attrs)?.[1] ?? 12);
    const text = unesc(m[3].replace(/<[^>]+>/g, ''));
    let list = out.get(shape);
    if (!list) { list = []; out.set(shape, list); }
    list.push({ x: xs[0], y: Math.max(...ys), size, text, cell });
  }
  return out;
}

/** 文字元素按基线分行：基线相差不到 0.4 个字号算同一行，行内按横坐标排 */
export function linesOf(items) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    const cur = lines[lines.length - 1];
    if (cur && Math.abs(it.y - cur.y) < Math.max(3, it.size * 0.4)) cur.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  return lines.map((l) => l.items.sort((a, b) => a.x - b.x).map((i) => i.text).join(''));
}

/** 比较时去掉所有空白：两端、分散对齐时空格单独成段、不出文字元素，空格不影响在哪个字换行 */
export const norm = (s) => s.replace(/[\s\u000b　]/gu, '');
