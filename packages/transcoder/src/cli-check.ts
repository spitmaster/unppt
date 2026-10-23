/** unppt check：字体检查结果的文字输出（数据来自 checkFonts，见 font/check.ts） */
import type { FontCheck } from './index';

/** 页码列表压成 "1–3、7、9–12" */
function pageRanges(pages: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < pages.length;) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
    out.push(j > i ? `${pages[i]}–${pages[j]}` : `${pages[i]}`);
    i = j + 1;
  }
  return `第 ${out.join('、')} 页`;
}

/** 开源字体的中文名 */
const CN: Record<string, string> = {
  'noto sans sc': '思源黑体', 'noto serif sc': '思源宋体', 'lxgw wenkai': '霞鹜文楷', 'zhuque fangsong (technical preview)': '朱雀仿宋',
};
const shown = (name = '') => (CN[name.toLowerCase()] ? `${CN[name.toLowerCase()]}（${name.replace(/ \(technical preview\)/i, '')}）` : name);

/** problemsOnly：只列有问题的字体（正常转码结束时用） */
export function formatFontCheck(r: FontCheck & { slides: number }, name: string, problemsOnly = false): string {
  const lines = [problemsOnly ? '字体：' : `字体检查：${name}（共 ${r.slides} 页）`];
  const width = Math.max(8, ...r.fonts.map((f) => [...f.font].reduce((a, c) => a + (c.charCodeAt(0) > 0x2e7f ? 2 : 1), 0)));
  const pad = (s: string) => s + ' '.repeat(Math.max(1, width + 2 - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2e7f ? 2 : 1), 0)));
  for (const f of r.fonts) {
    if (problemsOnly && f.status !== 'substituted' && f.status !== 'symbol-missing' && f.status !== 'missing') continue;
    const where = pageRanges(f.pages);
    const what = {
      embedded: ['✓', 'PPT 里嵌入了，照原样显示'],
      specified: ['✓', '用指定的字体'],
      default: ['✓', `排版按原字体，显示用 ${shown(f.shownWith)}`],
      substituted: ['⚠', `没有这个字体，按 ${f.substitute} 替代（字形和换行可能和作者电脑上不同）`],
      'symbol-missing': ['✗', '符号字体没有嵌入，符号会显示成字母或方框：请在 PowerPoint 里勾选"将字体嵌入文件"'],
      missing: ['✗', '没有这个字体，也没有替代字体，字宽只能估算（没装默认字体包 @unppt/fonts？）'],
    }[f.status];
    lines.push(`  ${what[0]} ${pad(f.font)}${where}   ${what[1]}`);
  }
  if (r.missingChars.length) {
    const n = new Set(r.missingChars.flatMap((m) => [...m.chars])).size;
    lines.push(`  ⚠ ${n} 个字没有字体能显示（由浏览器兜底，不同设备可能不同）：${r.missingChars.map((m) => `第 ${m.page} 页 ${m.chars}`).join('；')}`);
  }
  if (!problemsOnly) lines.push(r.errors || r.warnings ? `结论：${r.errors} 个必须处理的问题（✗），${r.warnings} 个提醒（⚠）` : '结论：没有问题');
  return lines.join('\n');
}
