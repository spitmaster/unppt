/**
 * 文档里每个字体名的字符集（a:latin / a:ea / a:cs 的 charset 属性）：缺失字体按它选替代字体（见 text/measure.ts）。
 * 实测（PowerPoint 探针）：同一个字体名整个文档只认一个字符集——最后一次明确写的那个（日→日→中 = 中，中→中→日 = 日，
 * 日→不写→不写 = 日），和每段文字自己写的无关。按 演示文稿、母版、版式、幻灯片 的顺序扫原始 XML（只取这两个属性，不建树）。
 */
import type { OpcPackage } from '../io/package';

const FONT_EL = /<a:(?:latin|ea|cs)\b([^>]*)>/g;
const TYPEFACE = /\btypeface="([^"]*)"/;
const CHARSET = /\bcharset="([^"]*)"/;

export async function scanFontCharsets(pkg: OpcPackage, presPart: string, slides: string[]): Promise<Map<string, string>> {
  const parts = [presPart];
  for (const m of (await pkg.rels(presPart)).filter((r) => r.type === 'slideMaster' && !r.external)) {
    parts.push(m.target);
    for (const l of (await pkg.rels(m.target)).filter((r) => r.type === 'slideLayout' && !r.external)) parts.push(l.target);
  }
  parts.push(...slides);
  const out = new Map<string, string>();
  for (const part of new Set(parts)) {
    const xml = await pkg.zip.readText(part);
    if (!xml) continue;
    for (const m of xml.matchAll(FONT_EL)) {
      const cs = CHARSET.exec(m[1])?.[1];
      const tf = cs ? TYPEFACE.exec(m[1])?.[1] : undefined;
      if (tf && !tf.startsWith('+')) out.set(tf.toLowerCase(), cs!);
    }
  }
  return out;
}
