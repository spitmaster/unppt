/**
 * PowerPoint 动画公式求值（不用 eval）：数字、+ - * / ^ %、括号、函数（sin cos tan asin acos atan sinh cosh tanh
 * sqrt abs exp ln floor ceil min max rand deg rad）、常量 pi e、变量（#ppt_x、ppt_w 等，以及 $）。
 * 写错或不认识的部分得到 NaN，调用方当作不起作用。
 */
type Fn = (vars: Record<string, number>) => number;

const FUNCS: Record<string, (...a: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp, ln: Math.log,
  floor: Math.floor, ceil: Math.ceil, min: Math.min, max: Math.max,
  // 随机数：每次播放一样（取中间值），保证跳转、截图稳定
  rand: (x) => x / 2,
  deg: (x) => (x * 180) / Math.PI, rad: (x) => (x * Math.PI) / 180,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

const TOKEN = /\s*(\d*\.\d+(?:e[+-]?\d+)?|\d+(?:\.\d*)?(?:e[+-]?\d+)?|#?[a-z_][a-z0-9_.]*|\$|[-+*/^%(),])/iy;

function compile(src: string): Fn {
  const toks: string[] = [];
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while (TOKEN.lastIndex < src.length && (m = TOKEN.exec(src))) toks.push(m[1]);
  if (src.slice(TOKEN.lastIndex).trim()) return () => NaN;
  let i = 0;
  const peek = () => toks[i];
  const take = () => toks[i++];
  const fail: Fn = () => NaN;

  function expr(): Fn {
    let a = term();
    while (peek() === '+' || peek() === '-') {
      const op = take(), l = a, r = term();
      a = op === '+' ? (v) => l(v) + r(v) : (v) => l(v) - r(v);
    }
    return a;
  }
  function term(): Fn {
    let a = unary();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = take(), l = a, r = unary();
      a = op === '*' ? (v) => l(v) * r(v) : op === '/' ? (v) => l(v) / r(v) : (v) => l(v) % r(v);
    }
    return a;
  }
  function unary(): Fn {
    if (peek() === '-') { take(); const a = unary(); return (v) => -a(v); }
    if (peek() === '+') { take(); return unary(); }
    return power();
  }
  function power(): Fn {
    const base = primary();
    if (peek() !== '^') return base;
    take();
    const ex = unary();
    return (v) => Math.pow(base(v), ex(v));
  }
  function primary(): Fn {
    const t = take();
    if (t === undefined) return fail;
    if (t === '(') {
      const a = expr();
      return take() === ')' ? a : fail;
    }
    if (/^[\d.]/.test(t)) { const n = Number(t); return () => n; }
    if (t === '$') return (v) => v.$;
    const name = t.replace(/^#/, '').toLowerCase();
    if (peek() === '(' && Object.prototype.hasOwnProperty.call(FUNCS, name)) {
      take();
      const args: Fn[] = [];
      if (peek() !== ')') {
        args.push(expr());
        while (peek() === ',') { take(); args.push(expr()); }
      }
      if (take() !== ')') return fail;
      const f = FUNCS[name];
      return (v) => f(...args.map((a) => a(v)));
    }
    if (Object.prototype.hasOwnProperty.call(CONSTS, name)) { const c = CONSTS[name]; return () => c; }
    if (/^[a-z_][a-z0-9_]*$/.test(name)) return (v) => (Object.prototype.hasOwnProperty.call(v, name) ? v[name] : NaN);
    return fail;
  }
  const f = expr();
  return i === toks.length ? f : fail;
}

const cache = new Map<string, Fn>();

/** 求值；vars 里放 ppt_x、ppt_y、ppt_w、ppt_h（元素原来的位置大小）和 $ */
export function evalFormula(src: string, vars: Record<string, number>): number {
  let f = cache.get(src);
  if (!f) {
    f = compile(src);
    if (cache.size > 500) cache.clear();
    cache.set(src, f);
  }
  return f(vars);
}
