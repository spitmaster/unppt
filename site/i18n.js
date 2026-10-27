// 中英文切换：页面里同一段话写两份（lang="zh" / lang="en"），按 ?lang=、上次的选择、浏览器语言决定显示哪份
const KEY = 'unppt-site-lang';
let lang = new URLSearchParams(location.search).get('lang');
try { lang ||= localStorage.getItem(KEY); } catch {}
lang = lang === 'en' || lang === 'zh' ? lang : (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
export function setLang(l) {
  lang = l;
  document.documentElement.dataset.lang = l;
  document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en';
  try { localStorage.setItem(KEY, l); } catch {}
  document.dispatchEvent(new CustomEvent('langchange'));
}
export const getLang = () => lang;
setLang(lang);
document.querySelectorAll('.lang').forEach((b) => b.addEventListener('click', () => setLang(lang === 'zh' ? 'en' : 'zh')));
