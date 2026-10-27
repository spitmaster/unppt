/**
 * 图表文字的字体（SPEC D3 ①）：chart/draw.ts 的 label 直接写字体名（'Calibri','等线',sans-serif），播放时会用观看者电脑上的字体。
 * 图表画好后，每段文字的每个字按和正文一样的办法找到字体（图表写的字体 -> 替代字体 -> 默认字体包的开源字体），记进嵌入的子集，
 * font-family 换成嵌入字体的别名（拉丁字母、汉字各在自己的子集里，浏览器按列表顺序逐字找到有字形的那个），字体检查也记一笔
 */
import type { FontFace, FontMetrics } from '../../font/font';
import type { FontLibrary } from '../../font/library';
import type { FontUse } from '../../font/check';
import type { FontEmbedder } from '../../text/types';

/** 图表写的字体都找不到时：中文用雅黑、西文用 Calibri（和正文缺字体时一样），再找默认字体包里的开源字体 */
const SUBS = ['Microsoft YaHei', 'Calibri', 'Noto Sans SC', 'Noto Serif SC', 'Liberation Sans'];

const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');

export async function embedChartFonts(svg: string, fonts: FontLibrary, embed: FontEmbedder | undefined, fontUse?: (u: FontUse) => void): Promise<string> {
  if (!embed && !fontUse) return svg;
  const loaded = new Map<FontFace, Promise<FontMetrics>>();
  const metrics = (f: FontFace) => {
    let p = loaded.get(f);
    if (!p) { p = f.load(); loaded.set(f, p); }
    return p;
  };
  /** 这个字体能不能画这个字：默认字体包的原字体要看显示用的开源字体有没有 */
  const draws = async (f: FontFace, cp: number) => {
    const m = await metrics(f).catch(() => undefined);
    return !!m && (m.shown ? m.shown(cp) : m.advance(cp) !== undefined);
  };
  const parts: string[] = [];
  let last = 0;
  for (const m of svg.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)) {
    const attrs = m[1];
    const fam = /\sfont-family="([^"]*)"/.exec(attrs)?.[1];
    if (!fam) continue;
    const bold = /\sfont-weight="bold"/.test(attrs), italic = /\sfont-style="italic"/.test(attrs);
    const names = fam.replace(/&quot;|&#39;|'/g, '').split(',').map((s) => s.trim()).filter((s) => s && s !== 'sans-serif' && s !== 'serif');
    const own = names.map((n) => fonts.find(n, bold, italic));
    const subs = SUBS.map((n) => fonts.find(n, bold, italic));
    const used: FontFace[] = [];
    for (const ch of unesc(m[2])) {
      const cp = ch.codePointAt(0)!;
      if (cp <= 0x20) continue;
      let face: FontFace | undefined;
      for (const f of [...own, ...subs]) if (f && await draws(f, cp)) { face = f; break; }
      // 图表写的字体找到了就算用上了（它没有的字，例如 Arial 标签里的汉字，和正文一样由东亚字体画，不算替代）
      const ownAt = own.findIndex(Boolean);
      fontUse?.({ requested: names[0] ?? '', picked: ownAt >= 0 ? names[ownAt] : face?.displayFamily ?? names[0] ?? '', pickedFace: own[ownAt] ?? face, face, cp });
      if (!face || !embed) continue;
      embed.use(face, cp);
      if (!used.includes(face)) used.push(face);
    }
    // 图表写的（西文）字体总排第一个：dominant-baseline="central" 按第一个字体的上下伸量定中线，全是汉字的标签换成东亚字体排第一
    // 会整行往下偏约 0.15 字高（全量课件比对，和 0.2.6、PowerPoint 不一致）；标签里一个字也没用到它时嵌入它的空格，让它在场
    const lead = own[0];
    if (lead && embed && used[0] !== lead) {
      if (!used.includes(lead)) embed.use(lead, 0x20);
      used.splice(0, used.length, lead, ...used.filter((f) => f !== lead));
    }
    const aliases = used.map((f) => embed?.alias(f)).filter((a): a is string => !!a);
    if (!aliases.length) continue;
    const list = [...aliases.map((a) => `'${a}'`), ...names.map((n) => `'${n.replace(/'/g, '')}'`), 'sans-serif'].join(',');
    const start = m.index! + 5;
    parts.push(svg.slice(last, start), attrs.replace(/\sfont-family="[^"]*"/, ` font-family="${list}"`));
    last = start + attrs.length;
  }
  parts.push(svg.slice(last));
  return parts.join('');
}
