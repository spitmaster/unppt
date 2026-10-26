/** 主题字体引用（+mn-lt、+mj-ea 等）-> 字体名：正文（text/style.ts）和图表文字（chart/theme-fonts.ts）共用 */
import type { Theme } from './model';

/** 文字语言 -> 主题字体里的脚本（a:font script） */
function scriptOfLang(lang: string | undefined): string | undefined {
  const l = (lang ?? '').toLowerCase();
  if (l.startsWith('zh')) return /^zh-(tw|hk|mo)/.test(l) ? 'Hant' : 'Hans';
  return l.startsWith('ja') ? 'Jpan' : l.startsWith('ko') ? 'Hang' : undefined;
}

/**
 * 主题字体（+mn-lt、+mj-ea 等）-> 字体名。lang 是文字语言：实测主题的东亚字体为空时，PowerPoint 按语言选主题里对应脚本的字体
 * （zh-CN 用 Hans、ja-JP 用 Jpan、zh-TW 用 Hant、ko-KR 用 Hang），lang 不是中日韩时看 altLang（实测 text-theme-ea-altlang：
 * en-US + altLang zh-CN 用 Hans）；都不是时不用主题字体——返回空串（runStyle 改用西文字体）
 */
export function resolveTypeface(tf: string | undefined, theme: Theme, lang?: string, altLang?: string): string | undefined {
  if (!tf) return undefined;
  const ea = (own: string, scripts: Record<string, string>) => {
    if (own) return own;
    const s = scriptOfLang(lang) ?? scriptOfLang(altLang);
    return (s && scripts[s]) || '';
  };
  switch (tf) {
    case '+mn-lt': return theme.minorLatin;
    case '+mj-lt': return theme.majorLatin;
    case '+mn-ea': return ea(theme.minorEaOwn, theme.minorScripts);
    case '+mj-ea': return ea(theme.majorEaOwn, theme.majorScripts);
    case '+mn-cs': case '+mj-cs': return theme.minorLatin;
  }
  return tf;
}
