/**
 * DrawingML 颜色：srgbClr / schemeClr / sysClr / prstClr / hslClr / scrgbClr，以及各种修饰
 * （lumMod、lumOff、tint、shade、alpha、satMod 等）。
 */
import type { XEl } from '../io/xml';

export interface Rgba { r: number; g: number; b: number; a: number; }

/** 解析主题色名用的上下文：clrMap 把 bg1/tx1 等映射到 lt1/dk1，scheme 是主题里的实际颜色 */
export interface ColorContext {
  scheme: Record<string, string>;      // dk1 -> 'RRGGBB'
  map: Record<string, string>;         // bg1 -> 'lt1'
  /** p:style 里 fillRef 等引用的颜色（schemeClr val="phClr" 时用） */
  placeholder?: Rgba;
}

const PRESET: Record<string, string> = {
  black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00',
  gray: '808080', grey: '808080', darkGray: 'A9A9A9', lightGray: 'D3D3D3', orange: 'FFA500',
  purple: '800080', cyan: '00FFFF', magenta: 'FF00FF', navy: '000080', maroon: '800000', silver: 'C0C0C0',
  lime: '00FF00', olive: '808000', teal: '008080', aqua: '00FFFF', fuchsia: 'FF00FF',
  darkBlue: '00008B', darkRed: '8B0000', darkGreen: '006400', lightBlue: 'ADD8E6', pink: 'FFC0CB',
};

function hex(h: string): Rgba {
  const v = parseInt(h.padStart(6, '0').slice(0, 6), 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255, a: 1 };
}

function rgbToHsl({ r, g, b }: Rgba): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number, a: number): Rgba {
  const f = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  if (s === 0) { const v = Math.round(l * 255); return { r: v, g: v, b: v, a }; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return { r: Math.round(f(p, q, h + 1 / 3) * 255), g: Math.round(f(p, q, h) * 255), b: Math.round(f(p, q, h - 1 / 3) * 255), a };
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

// sRGB 与线性空间互转（tint/shade 在线性空间里计算，和 PowerPoint 一致）
const toLin = (c: number) => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
const toSrgbF = (x: number) => { const v = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; return clamp01(v) * 255; };
const toSrgb = (x: number) => Math.round(toSrgbF(x));

function applyMods(c: Rgba, mods: XEl[]): Rgba {
  let col = { ...c };
  // gamma ... invGamma 之间：中间结果不取整（实测 colors-gamma：取整会差 1~2）
  let inGamma = false;
  const ch = (f: (x: number) => number) => { col = { r: f(col.r), g: f(col.g), b: f(col.b), a: col.a }; };
  for (const m of mods) {
    const val = Number(m.attrs.val ?? 0) / 100000;
    const name = m.name.slice(2);
    switch (name) {
      // 实测（colors-gamma，老 .ppt 转换来的文件常见）：gamma 把颜色当线性值按 sRGB 编码，invGamma 解码回来；
      // 包在中间的 tint / shade 因此等于直接在 sRGB 上混合（shade 0.46 的 FEEC94 -> 76 6D 44），lumMod 等也在编码后的值上算
      case 'gamma': inGamma = true; ch((x) => toSrgbF(x / 255)); break;
      case 'invGamma': inGamma = false; ch((x) => Math.round(toLin(x) * 255)); break;
      case 'tint': ch((x) => (inGamma ? toSrgbF : toSrgb)(toLin(x) * val + (1 - val))); break;
      case 'shade': ch((x) => (inGamma ? toSrgbF : toSrgb)(toLin(x) * val)); break;
      case 'alpha': col.a = val; break;
      case 'alphaMod': col.a = clamp01(col.a * val); break;
      case 'alphaOff': col.a = clamp01(col.a + val); break;
      case 'lumMod': case 'lumOff': case 'satMod': case 'satOff': case 'hueMod': case 'hueOff': case 'sat': case 'lum': case 'hue': {
        let [h, s, l] = rgbToHsl(col);
        if (name === 'lumMod') l *= val;
        else if (name === 'lumOff') l += val;
        else if (name === 'lum') l = val;
        else if (name === 'satMod') s *= val;
        else if (name === 'satOff') s += val;
        else if (name === 'sat') s = val;
        else if (name === 'hueMod') h = (h * val) % 1;
        else if (name === 'hueOff') h = (h + Number(m.attrs.val ?? 0) / 21600000) % 1;
        else if (name === 'hue') h = Number(m.attrs.val ?? 0) / 21600000;
        col = hslToRgb(h, clamp01(s), clamp01(l), col.a);
        break;
      }
      case 'inv': col = { r: 255 - col.r, g: 255 - col.g, b: 255 - col.b, a: col.a }; break;
      case 'gray': { const v = Math.round(col.r * 0.3 + col.g * 0.59 + col.b * 0.11); col = { r: v, g: v, b: v, a: col.a }; break; }
      case 'comp': { const [h, s, l] = rgbToHsl(col); col = hslToRgb((h + 0.5) % 1, s, l, col.a); break; }
      case 'red': col.r = Math.round(clamp01(val) * 255); break;
      case 'green': col.g = Math.round(clamp01(val) * 255); break;
      case 'blue': col.b = Math.round(clamp01(val) * 255); break;
      case 'redMod': col.r = Math.round(clamp01(col.r / 255 * val) * 255); break;
      case 'greenMod': col.g = Math.round(clamp01(col.g / 255 * val) * 255); break;
      case 'blueMod': col.b = Math.round(clamp01(col.b / 255 * val) * 255); break;
      default: break;
    }
  }
  if (inGamma) ch(Math.round);
  return col;
}

/** 解析颜色元素（a:srgbClr 等本身），找不到时返回 undefined */
export function parseColorEl(el: XEl | undefined, ctx: ColorContext): Rgba | undefined {
  if (!el) return undefined;
  let base: Rgba | undefined;
  switch (el.name) {
    case 'a:srgbClr': base = hex(el.attrs.val ?? '000000'); break;
    case 'a:sysClr': base = hex(el.attrs.lastClr ?? (el.attrs.val === 'window' ? 'FFFFFF' : '000000')); break;
    case 'a:prstClr': base = hex(PRESET[el.attrs.val ?? ''] ?? '000000'); break;
    case 'a:scrgbClr': base = {
      r: toSrgb(Number(el.attrs.r ?? 0) / 100000), g: toSrgb(Number(el.attrs.g ?? 0) / 100000),
      b: toSrgb(Number(el.attrs.b ?? 0) / 100000), a: 1,
    }; break;
    case 'a:hslClr': base = hslToRgb(Number(el.attrs.hue ?? 0) / 21600000, Number(el.attrs.sat ?? 0) / 100000, Number(el.attrs.lum ?? 0) / 100000, 1); break;
    case 'a:schemeClr': {
      const v = el.attrs.val ?? '';
      if (v === 'phClr') { base = ctx.placeholder ?? { r: 0, g: 0, b: 0, a: 1 }; break; }
      const mapped = ctx.map[v] ?? v;
      const h = ctx.scheme[mapped] ?? ctx.scheme[v];
      base = h ? hex(h) : { r: 0, g: 0, b: 0, a: 1 };
      break;
    }
    default: return undefined;
  }
  return applyMods(base, el.children);
}

/** 在一个容器（如 a:solidFill）里找颜色子元素并解析 */
export function colorIn(container: XEl | undefined, ctx: ColorContext): Rgba | undefined {
  if (!container) return undefined;
  for (const c of container.children) {
    const r = parseColorEl(c, ctx);
    if (r) return r;
  }
  return undefined;
}

export function css(c: Rgba): string {
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

export function opacity(c: Rgba): string | undefined {
  return c.a < 0.999 ? (Math.round(c.a * 1000) / 1000).toString() : undefined;
}
