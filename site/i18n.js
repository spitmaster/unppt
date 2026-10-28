// 中英文切换：页面里同一段话写两份（lang="zh" / lang="en"），按 ?lang=、上次的选择、浏览器语言决定显示哪份
const KEY = 'unppt-site-lang';
let lang = new URLSearchParams(location.search).get('lang');
try { lang ||= localStorage.getItem(KEY); } catch {}
lang = lang === 'en' || lang === 'zh' ? lang : (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
// 链接也要跟着语言走：带 data-href-zh / data-href-en 的 <a>，以及由脚本生成的 demo 卡片链接（data-demo）
export function applyLangLinks() {
  for (const a of document.querySelectorAll('a[data-href-zh], a[data-href-en]')) {
    const target = lang === 'zh' ? a.dataset.hrefZh : a.dataset.hrefEn;
    if (target) a.href = target;
  }
  for (const a of document.querySelectorAll('a[data-demo]')) {
    a.href = `demo.html?lang=${lang}&d=${encodeURIComponent(a.dataset.demo)}`;
  }
}
export function setLang(l) {
  lang = l;
  document.documentElement.dataset.lang = l;
  document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en';
  applyLangLinks();
  try { localStorage.setItem(KEY, l); } catch {}
  document.dispatchEvent(new CustomEvent('langchange'));
}
export const getLang = () => lang;
setLang(lang);
document.querySelectorAll('.lang').forEach((b) => b.addEventListener('click', () => setLang(lang === 'zh' ? 'en' : 'zh')));
