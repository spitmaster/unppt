/**
 * Excel 日期 / 时间格式（图表的分类、坐标轴、数据表用）：按格式代码逐个替换——yyyy / yy 年，m / mm 月（紧跟 h 之后或 s 之前的是分钟），
 * mmm / mmmm 英文月名，d / dd 日，ddd / dddd 星期，h / hh 时，s / ss 秒，AM/PM；引号里的文字、反斜杠转义的字原样，"_x" 留一个空格，"*x" 不画，
 * 其它字符（/ - . : 空格、年月日这类汉字）照写（样本：yyyy"年"m"月" 以前一律画成 2020/9）
 */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const pad = (n: number, w: number) => String(n).padStart(w, '0');

/**
 * Excel 内置的"系统短日期"格式（编号 14、22，文件里写成 m/d/yyyy、m/d/yy h:mm）按系统区域显示：中文系统是 yyyy/m/d
 * （实测 charts-pct-stacked：日期轴 m/d/yyyy 显示成 2002/1/5）
 */
const SYSTEM_DATE: Record<string, string> = { 'm/d/yyyy': 'yyyy/m/d', 'm/d/yy h:mm': 'yyyy/m/d h:mm' };

/** sec 是去掉方括号部分后的一段格式代码；serial 是 Excel 日期序号（1900 系统） */
export function formatDate(serial: number, sec: string): string {
  sec = SYSTEM_DATE[sec.trim().toLowerCase()] ?? sec;
  const ms = Math.round(serial * 86400000);
  const d = new Date(Date.UTC(1899, 11, 30) + ms);
  const y = d.getUTCFullYear(), mo = d.getUTCMonth(), day = d.getUTCDate(), wd = d.getUTCDay();
  const h = d.getUTCHours(), mi = d.getUTCMinutes(), s = d.getUTCSeconds();
  const ampm = /am\/pm|a\/p/i.test(sec);
  // 先切成记号，再决定 m 是月还是分
  type Tok = { k: string; n: number } | { lit: string };
  const toks: Tok[] = [];
  for (let i = 0; i < sec.length; i++) {
    const c = sec[i], lc = c.toLowerCase();
    if (c === '"') { const j = sec.indexOf('"', i + 1); toks.push({ lit: sec.slice(i + 1, j < 0 ? sec.length : j) }); i = j < 0 ? sec.length : j; continue; }
    if (c === '\\') { toks.push({ lit: sec[++i] ?? '' }); continue; }
    if (c === '_') { i++; toks.push({ lit: ' ' }); continue; }
    if (c === '*') { i++; continue; }
    if (/^am\/pm/i.test(sec.slice(i))) { toks.push({ lit: h < 12 ? 'AM' : 'PM' }); i += 4; continue; }
    if (/^a\/p/i.test(sec.slice(i))) { toks.push({ lit: h < 12 ? 'A' : 'P' }); i += 2; continue; }
    if ('ymdhs'.includes(lc)) {
      let n = 1;
      while (sec[i + n]?.toLowerCase() === lc) n++;
      toks.push({ k: lc, n });
      i += n - 1;
      continue;
    }
    toks.push({ lit: c });
  }
  const kinds = toks.map((t) => ('k' in t ? t.k : ''));
  let out = '';
  toks.forEach((t, i) => {
    if ('lit' in t) { out += t.lit; return; }
    const { k, n } = t;
    if (k === 'y') { out += n <= 2 ? pad(y % 100, 2) : String(y); return; }
    if (k === 'd') { out += n === 1 ? String(day) : n === 2 ? pad(day, 2) : n === 3 ? DAYS[wd].slice(0, 3) : DAYS[wd]; return; }
    if (k === 'h') { const hh = ampm ? (h % 12 || 12) : h; out += n === 1 ? String(hh) : pad(hh, 2); return; }
    if (k === 's') { out += n === 1 ? String(s) : pad(s, 2); return; }
    // m：前面最近的日期记号是 h、或者后面最近的是 s 时是分钟
    const prev = kinds.slice(0, i).reverse().find((x) => x), next = kinds.slice(i + 1).find((x) => x);
    if (n <= 2 && (prev === 'h' || next === 's')) { out += n === 1 ? String(mi) : pad(mi, 2); return; }
    out += n === 1 ? String(mo + 1) : n === 2 ? pad(mo + 1, 2) : n === 3 ? MONTHS[mo].slice(0, 3) : n === 4 ? MONTHS[mo] : MONTHS[mo][0];
  });
  return out;
}
