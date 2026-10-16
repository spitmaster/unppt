/**
 * 光栅化：用 resvg（WASM，MPL-2.0，SPEC D1/D6）把页面 SVG 画成像素，再由 slide-images.ts 存成 JPG。
 * resvg 不认浏览器的字体回退，所以画之前：
 *   - 页面里的字体名换成这一页实际用到的字体文件里的英文名，并把这些字体文件交给 resvg；
 *   - 嵌套的 SVG 图片（EMF / WMF 转出来的）展开成页面里的普通元素（resvg 画嵌套图片时不带字体，文字会丢）。
 */
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import type { FontFace } from '../font/font';
import { base64 } from '../media/media';
import { cullOccluded } from './occlusion';
import { withHugeImagesShrunk } from './huge-images';

export interface RgbaImage { width: number; height: number; data: Uint8Array }

/** 按字体名（可能是嵌入字体的别名）和粗细斜找字体文件 */
export type FontResolver = (family: string, bold: boolean, italic: boolean) => FontFace | undefined;

/** 页面里图片地址 -> 原图字节 */
export type ImageSource = (href: string) => Promise<Uint8Array | undefined>;

export interface Rasterizer {
  /** 原图由 resvg 自己解码、缩放（Rust 编译的 WASM，比我们的纯 JS 解码快得多） */
  render(svg: string, width: number, images: ImageSource): Promise<RgbaImage | undefined>;
}

let ready: Promise<void> | undefined;

/** wasm：resvg 的 .wasm 文件字节（命令行读 dist/resvg.wasm）；整个进程只初始化一次 */
export async function resvgRasterizer(wasm: Uint8Array, fonts: FontResolver): Promise<Rasterizer> {
  ready ??= initWasm(wasm);
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
  // 超大 JPEG 缩小后的版本（huge-images.ts），跨页共用
  const shrunk = new Map<string, Promise<Uint8Array | undefined>>();
  return {
    async render(svg, width, original) {
      const images = withHugeImagesShrunk(original, shrunk);
      const used = new Set<FontFace>();
      // resvg 只把 http(s) 地址报成"待解析图片"：media/…、共享图片编号先换成占位地址，再按占位地址把原图交给它
      const real = new Map<string, string>();
      // 被整页不透明图片盖住的元素先剔除（像素不变），它们的图片就不用再读、再解码
      const src = rewriteFonts(await inlinePatternImages(await inlineSvgImages(await cullOccluded(svg, images), images), images), fonts, used)
        .replace(/(<image\b[^>]*?\s(?:xlink:)?href=")([^"#][^"]*)"/g, (m, pre: string, h: string) => {
          if (h.startsWith('data:')) return m;
          const u = `https://unppt.local/${real.size}`;
          real.set(u, h);
          return `${pre}${u}"`;
        });
      const buffers = (await Promise.all([...used].map(fontBytes))).filter((b): b is Uint8Array => !!b);
      const first = [...used][0];
      const r = new Resvg(src, {
        fitTo: { mode: 'width', value: width },
        background: '#ffffff',
        font: { fontBuffers: buffers, loadSystemFonts: false, ...(first ? { defaultFontFamily: first.displayFamily } : {}) },
      });
      try {
        // 页面里引用的图片文件（media/…、共享图片编号）：把原图字节交给 resvg
        for (const h of r.imagesToResolve() as string[]) {
          const b = await images(real.get(h) ?? h);
          if (b) r.resolveImage(h, b);
        }
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

/**
 * 嵌套的 SVG 图片（data:image/svg+xml 或者写成文件的 .svg）展开成 <g …><svg x y width height viewBox>内容</svg></g>，id 加前缀防冲突
 */
async function inlineSvgImages(svg: string, images: ImageSource): Promise<string> {
  const map = new Map<string, string>();
  let n = 0;
  for (const [tag] of svg.matchAll(/<image\b[^>]*>/g)) {
    if (map.has(tag)) continue;
    const href = /\s(?:xlink:)?href="([^"]+)"/.exec(tag)?.[1];
    if (!href) continue;
    let inner: string | undefined;
    if (href.startsWith('data:image/svg+xml;base64,')) inner = decodeBase64(href.slice(26));
    else if (/\.svg$/i.test(href)) {
      const b = await images(href);
      inner = b ? new TextDecoder().decode(b) : undefined;
    }
    const root = inner ? /^(?:<\?xml[^>]*>\s*)?<svg\b([^>]*)>([\s\S]*)<\/svg>\s*$/.exec(inner.trim()) : null;
    if (!root) continue;
    const attrs = tag.replace(/^<image\b/, '').replace(/\/?>$/, '').replace(/\s(?:xlink:)?href="[^"]*"/, '');
    const get = (k: string) => new RegExp(`\\s${k}="([^"]*)"`).exec(attrs)?.[1];
    const viewBox = /\sviewBox="([^"]*)"/.exec(root[1])?.[1];
    const par = get('preserveAspectRatio') ?? /\spreserveAspectRatio="([^"]*)"/.exec(root[1])?.[1];
    // 其余属性（transform、clip-path、opacity、filter…）放到外面的 g 上
    const rest = attrs.replace(/\s(x|y|width|height|preserveAspectRatio)="[^"]*"/g, '').trim();
    const p = `ni${n++}_`;
    const body = root[2].replace(/\sid="([^"]+)"/g, ` id="${p}$1"`).replace(/url\(#([^)]+)\)/g, `url(#${p}$1)`).replace(/(\s(?:xlink:)?href=")#([^"]+)"/g, `$1#${p}$2"`);
    const box = ['x', 'y', 'width', 'height'].map((k) => (get(k) !== undefined ? ` ${k}="${get(k)}"` : '')).join('');
    map.set(tag, `<g${rest ? ` ${rest}` : ''}><svg${box}${viewBox ? ` viewBox="${viewBox}"` : ''}${par ? ` preserveAspectRatio="${par}"` : ''}>${body}</svg></g>`);
  }
  return map.size ? svg.replace(/<image\b[^>]*>/g, (t) => map.get(t) ?? t) : svg;
}

/** resvg 不把 <pattern> 里的图片报成待解析（实测：图片填充、背景图都画成空白），这些图片直接内联成 data URI */
async function inlinePatternImages(svg: string, images: ImageSource): Promise<string> {
  const out: string[] = [];
  let last = 0;
  for (const m of svg.matchAll(/<pattern\b[\s\S]*?<\/pattern>/g)) {
    let body = m[0];
    for (const [tag, pre, href] of body.matchAll(/(<image\b[^>]*?\s(?:xlink:)?href=")([^"#][^"]*)"/g)) {
      if (href.startsWith('data:')) continue;
      const b = await images(href);
      if (b) body = body.replace(tag, () => `${pre}data:${mimeOf(b)};base64,${base64(b)}"`);
    }
    out.push(svg.slice(last, m.index), body);
    last = m.index! + m[0].length;
  }
  out.push(svg.slice(last));
  return out.join('');
}

function mimeOf(b: Uint8Array): string {
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49) return 'image/webp';
  return 'image/svg+xml';
}


function decodeBase64(b64: string): string {
  const s = atob(b64);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return new TextDecoder().decode(b);
}
