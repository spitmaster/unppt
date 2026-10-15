/**
 * 每页渲染时各字体名的字符集（a:latin / a:ea / a:cs 的 charset 属性）：缺失字体按它选替代字体（见 text/measure.ts）。
 * 实测（PowerPoint 探针，同页和跨页）：同一个字体名共用一个字符集，PowerPoint 按 演示文稿、母版、版式、第 1 页、第 2 页…… 的顺序加载，
 * 每次明确写 charset 都会改它；渲染第 k 页时用的是加载完第 k 页后的值（同一页里以最后一次为准，日→日→中 = 中），
 * 后面页面写的还没加载、不影响前面的页（中、无、无、日 四页 = 中、中、中、日）；到这页为止都没写过的不算。
 * 只扫原始 XML 取这两个属性，不建树。
 */
import type { OpcPackage } from '../io/package';

const FONT_EL = /<a:(?:latin|ea|cs)\b([^>]*)>/g;
const TYPEFACE = /\btypeface="([^"]*)"/;
const CHARSET = /\bcharset="([^"]*)"/;

/** 返回每页一张表（按 slides 的顺序）：小写字体名 -> charset */
export async function scanFontCharsets(pkg: OpcPackage, presPart: string, slides: string[]): Promise<Map<string, string>[]> {
  const base = [presPart];
  for (const m of (await pkg.rels(presPart)).filter((r) => r.type === 'slideMaster' && !r.external)) {
    base.push(m.target);
    for (const l of (await pkg.rels(m.target)).filter((r) => r.type === 'slideLayout' && !r.external)) base.push(l.target);
  }
  const state = new Map<string, string>();
  const scan = async (part: string) => {
    const xml = await pkg.zip.readText(part);
    if (!xml) return false;
    let changed = false;
    for (const m of xml.matchAll(FONT_EL)) {
      const cs = CHARSET.exec(m[1])?.[1];
      const tf = cs ? TYPEFACE.exec(m[1])?.[1]?.toLowerCase() : undefined;
      if (tf && !tf.startsWith('+') && state.get(tf) !== cs) { state.set(tf, cs!); changed = true; }
    }
    return changed;
  };
  for (const part of new Set(base)) await scan(part);
  const out: Map<string, string>[] = [];
  let snap = new Map(state);
  for (const part of slides) {
    // 没变化的页共用上一张表
    if (await scan(part)) snap = new Map(state);
    out.push(snap);
  }
  return out;
}
