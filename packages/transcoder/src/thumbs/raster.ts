/**
 * 缩略图光栅化：用 resvg（WASM，MPL-2.0，SPEC D1/D6）把缩略图 SVG 画成像素，再由 thumbnail.ts 存成 JPG。
 * resvg 不认浏览器的字体回退，所以画之前：
 *   - 页面里的字体名换成这一页实际用到的字体文件里的英文名，并把这些字体文件交给 resvg；
 *   - 嵌套的 SVG 图片（EMF / WMF 转出来的）展开成页面里的普通元素（resvg 画嵌套图片时不带字体，文字会丢）。
 */
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import type { FontFace } from '../font/font';
import type { RgbaImage } from '../media/png-decode';

/** 按字体名（可能是嵌入字体的别名）和粗细斜找字体文件 */
export type FontResolver = (family: string, bold: boolean, italic: boolean) => FontFace | undefined;

export interface Rasterizer {
  render(svg: string, width: number, height: number): Promise<RgbaImage | undefined>;
}

let ready: Promise<void> | undefined;

/** wasm：resvg 的 .wasm 文件字节（命令行读 dist/resvg.wasm）；整个进程只初始化一次 */
export async function resvgRasterizer(wasm: Uint8Array | Promise<Uint8Array>, fonts: FontResolver): Promise<Rasterizer> {
  ready ??= Promise.resolve(wasm).then((w) => initWasm(w));
  await ready;
  const bytes = new Map<FontFace, Promise<Uint8Array | undefined>>();
  const fontBytes = (f: FontFace) => {
    let p = bytes.get(f);
    if (!p) {
      p = f.source.read(0, f.source.size).catch(() => undefined);
      bytes.set(f, p);
    }
    return p;
  };
  return {
    async render(svg, width) {
      const used = new Set<FontFace>();
      const src = rewriteFonts(inlineSvgImages(svg), fonts, used);
      const buffers = (await Promise.all([...used].map(fontBytes))).filter((b): b is Uint8Array => !!b);
      const first = [...used][0];
      const r = new Resvg(src, {
        fitTo: { mode: 'width', value: width },
        background: '#ffffff',
        font: { fontBuffers: buffers, loadSystemFonts: false, ...(first ? { defaultFontFamily: first.displayFamily } : {}) },
      });
      try {
        const img = r.render();
        const out = { width: img.width, height: img.height, data: new Uint8Array(img.pixels) };
        img.free();
        return out;
      } finally {
        r.free();
      }
    },
  };
}

/** font-family="'甲','乙',sans-serif" 换成能找到的字体文件的英文名；找到的字体记进 used */
function rewriteFonts(svg: string, fonts: FontResolver, used: Set<FontFace>): string {
  return svg.replace(/<(text|tspan)\b([^>]*)>/g, (tag, _name: string, attrs: string) => {
    const fam = /\sfont-family="([^"]*)"/.exec(attrs)?.[1];
    if (!fam) return tag;
    const bold = /\sfont-weight="(bold|[6-9]00)"/.test(attrs), italic = /\sfont-style="italic"/.test(attrs);
    const names = fam.replace(/&quot;|&#39;|'/g, '').split(',').map((s) => s.trim()).filter(Boolean);
    let face: FontFace | undefined;
    for (const n of names) {
      face = fonts(n, bold, italic);
      if (face) break;
    }
    if (!face) return tag;
    used.add(face);
    // 同一家族的常规 / 粗体都交给 resvg，它按 font-weight 自己挑
    const other = fonts(face.displayFamily, !bold, italic);
    if (other) used.add(other);
    return tag.replace(/\sfont-family="[^"]*"/, ` font-family="${face.displayFamily.replace(/"/g, '')}"`);
  });
}

/** <image href="data:image/svg+xml;base64,…" x y width height …> 展开成 <g …><svg x y width height viewBox>内容</svg></g>，id 加前缀防冲突 */
function inlineSvgImages(svg: string): string {
  let n = 0;
  return svg.replace(/<image\b([^>]*?)\shref="data:image\/svg\+xml;base64,([^"]+)"([^>]*?)\/?>/g, (whole, a: string, b64: string, c: string) => {
    let inner: string;
    try { inner = decodeBase64(b64); } catch { return whole; }
    const root = /^<svg\b([^>]*)>([\s\S]*)<\/svg>\s*$/.exec(inner.trim());
    if (!root) return whole;
    const attrs = `${a} ${c}`;
    const get = (k: string) => new RegExp(`\\s${k}="([^"]*)"`).exec(attrs)?.[1];
    const viewBox = /\sviewBox="([^"]*)"/.exec(root[1])?.[1];
    const par = get('preserveAspectRatio') ?? /\spreserveAspectRatio="([^"]*)"/.exec(root[1])?.[1];
    // 其余属性（transform、clip-path、opacity、filter…）放到外面的 g 上
    const rest = attrs.replace(/\s(x|y|width|height|preserveAspectRatio)="[^"]*"/g, '').trim();
    const p = `ni${n++}_`;
    const body = root[2].replace(/\sid="([^"]+)"/g, ` id="${p}$1"`).replace(/url\(#([^)]+)\)/g, `url(#${p}$1)`).replace(/(\s(?:xlink:)?href=")#([^"]+)"/g, `$1#${p}$2"`);
    const box = ['x', 'y', 'width', 'height'].map((k) => (get(k) !== undefined ? ` ${k}="${get(k)}"` : '')).join('');
    return `<g${rest ? ` ${rest}` : ''}><svg${box}${viewBox ? ` viewBox="${viewBox}"` : ''}${par ? ` preserveAspectRatio="${par}"` : ''}>${body}</svg></g>`;
  });
}

function decodeBase64(b64: string): string {
  const s = atob(b64);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return new TextDecoder().decode(b);
}
