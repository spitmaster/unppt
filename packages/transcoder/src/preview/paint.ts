/**
 * 出图的"绘制"一半（和运行环境无关：本线程画、工作线程画都用这一份，所以结果逐字节一致）：
 * 按 prepare.ts 准备好的页面 SVG 用 resvg（WASM，MPL-2.0，SPEC D1/D6）画成像素——背景层有缓存时只画本页内容再叠上去
 * （layers.ts）——再缩出缩略图，两张都编成 JPEG（libjpeg-turbo）。
 * 绘制要的字体、图片、背景层 SVG 都按编号向 resources 要（工作线程里由主线程按需发过来），自己按字节数缓存。
 */
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { base64 } from '../media/media';
import { jpegEncoder, type JpegEncode } from '../media/jpeg-encode';
import { composite, TemplateCache } from './layers';
import { dropCrashingFilters, lightingFilters } from './crash-filters';
import { warpPixels, type MeshWarp } from './mesh-warp';
import { encodeRgba } from '../media/png';

export interface RgbaImage { width: number; height: number; data: Uint8Array }

/** 一张要画的 SVG：字体名已经换成字体文件里的英文名，fonts 是要交给 resvg 的字体编号 */
export interface PaintSvg {
  svg: string;
  fonts: string[];
  /** resvg 的默认字体（这张 SVG 用到的第一个字体） */
  defaultFamily?: string;
}

export interface PaintJob {
  /** 哪一次转换（缓存按它区分；一个工作线程换到下一次转换时清掉上一次的缓存） */
  conv: string;
  /** 页号（从 1 开始），只用于提示 */
  page: number;
  /** 本页：有背景层时只有本页内容（画在透明画布上），否则是整页（垫白底） */
  main: PaintSvg;
  /** 背景层编号（layers.ts）：有时先取背景层位图（没有就向 resources 要 SVG 画一张），再把 main 叠上去 */
  template?: string;
  picWidth: number;
  thumbWidth: number;
  thumbHeight: number;
}

/** 单独画成位图的 SVG（inline-svg.ts 的嵌套 SVG 图片、mesh-warp.ts 的透视投影图片内容）：画成 width 像素宽 */
export interface RasterSvg extends PaintSvg {
  width: number;
  /** 画好后按三角形贴成投影后的样子 */
  warp?: MeshWarp;
}

/** 页面里引用单独画成位图的 SVG 图片的地址前缀，后面是编号（向 resources.raster 要） */
export const RASTER_PREFIX = 'unppt-raster:';

export interface PaintResources {
  font(id: string): Promise<Uint8Array | undefined>;
  /** 页面里图片地址（属性原文，可能带 &amp;）-> 图片字节 */
  image(href: string): Promise<Uint8Array | undefined>;
  template(id: string): Promise<PaintSvg | undefined>;
  raster(id: string): Promise<RasterSvg | undefined>;
}

export interface PaintResult {
  pic?: Uint8Array;
  thum?: Uint8Array;
  warnings: string[];
  /** 这次画背景层时的警告（背景层每个线程画一次，调用方按背景层编号只记一次） */
  layerWarnings?: string[];
}

export interface Painter {
  paint(job: PaintJob, resources: PaintResources): Promise<PaintResult>;
}

const JPEG_QUALITY = 85;
/** 每个线程缓存的 <pattern> 图片 data URI 总长度上限（字符数，约等于字节数） */
const URI_CACHE = 64_000_000;

let ready: Promise<void> | undefined;
/** 这个线程里 resvg 出错（Rust panic）的次数：每次会漏掉一点 WASM 栈，实测 800 次以内画别的页结果不变、2000 次后内存越界 */
let crashes = 0;

/** 这个线程里 resvg 出错的次数（出图线程超过一定次数就换新线程，见 raster-worker.ts） */
export function resvgCrashes(): number {
  return crashes;
}

/** wasm：resvg 的 .wasm 字节（或编译好的模块）；整个线程只初始化一次 */
export async function createPainter(wasm: Uint8Array | WebAssembly.Module): Promise<Painter> {
  ready ??= initWasm(wasm);
  await ready;
  let conv = '';
  let fonts = new Map<string, Promise<Uint8Array | undefined>>();
  let layers = new TemplateCache();
  /** 单独画成位图的 SVG 图片（PNG），这次转换里共用 */
  let rasters = new Map<string, Promise<Uint8Array | undefined>>();
  /** <pattern> 里图片的 data URI（每页都用同一张背景图时不必每页重新编码），按长度只留最近的 URI_CACHE 个字符 */
  let uris = new Map<string, string>();
  let urisLength = 0;

  async function dataUri(href: string, res: PaintResources, warnings: string[]): Promise<string | undefined> {
    const hit = uris.get(href);
    if (hit) return hit;
    const b = await imageBytes(href, res, warnings);
    if (!b) return undefined;
    const uri = `data:${mimeOf(b)};base64,${base64(b)}`;
    if (uri.length <= URI_CACHE) {
      for (const [k, v] of uris) {
        if (urisLength + uri.length <= URI_CACHE) break;
        uris.delete(k);
        urisLength -= v.length;
      }
      uris.set(href, uri);
      urisLength += uri.length;
    }
    return uri;
  }

  /** 页面里图片地址 -> 图片字节；单独画成位图的 SVG 图片在这里画（画一次） */
  function imageBytes(href: string, res: PaintResources, warnings: string[]): Promise<Uint8Array | undefined> {
    if (!href.startsWith(RASTER_PREFIX)) return res.image(href);
    const id = href.slice(RASTER_PREFIX.length);
    let p = rasters.get(id);
    if (!p) {
      p = res.raster(id).then(async (s) => {
        if (!s) return undefined;
        if (!s.warp) return draw(s, s.width, res, warnings, undefined, (img) => new Uint8Array(img.asPng()));
        const img = await renderSafe(s, s.width, res, warnings);
        return encodeRgba(warpPixels(img.data, img.width, img.height, s.warp), s.warp.width, s.warp.height);
      })
        .catch((e: Error) => { warnings.push(`整页图里有图片画不出来，没画这张：${e.message}`); return undefined; });
      rasters.set(id, p);
    }
    return p;
  }

  function render(p: PaintSvg, width: number, res: PaintResources, warnings: string[], background?: string): Promise<RgbaImage> {
    return draw(p, width, res, warnings, background, (img) => ({ width: img.width, height: img.height, data: new Uint8Array(img.pixels) }));
  }

  /** 画一张 SVG；background 不给时画在透明画布上（像素是预乘透明度的）；take 从画好的图里取要的东西 */
  async function draw<T>(p: PaintSvg, width: number, res: PaintResources, warnings: string[], background: string | undefined,
    take: (img: { width: number; height: number; pixels: Uint8Array; asPng(): Uint8Array }) => T): Promise<T> {
    const { svg: src, real } = await imageHrefs(p.svg, (h) => dataUri(h, res, warnings));
    const buffers: Uint8Array[] = [];
    for (const id of p.fonts) {
      let b = fonts.get(id);
      if (!b) { b = res.font(id); fonts.set(id, b); }
      const bytes = await b;
      if (bytes) buffers.push(bytes);
    }
    const r = new Resvg(src, {
      fitTo: { mode: 'width', value: width },
      ...(background ? { background } : {}),
      font: { fontBuffers: buffers, loadSystemFonts: false, ...(p.defaultFamily ? { defaultFontFamily: p.defaultFamily } : {}) },
    });
    try {
      for (const h of r.imagesToResolve() as string[]) {
        const b = await imageBytes(real.get(h) ?? h, res, warnings);
        if (!b) continue;
        // resvg 只认 PNG、JPEG、GIF：别的格式（BMP、WebP、ICO 等）这一张不画，页面其它内容照画
        try {
          r.resolveImage(h, b);
        } catch (e) {
          warnings.push(`整页图里有图片画不出来，没画这张：${(e as Error).message}`);
        }
      }
      const img = r.render();
      try {
        return take(img);
      } finally {
        img.free();
      }
    } finally {
      // resvg 内部出错（Rust panic）后这个对象还处在借用状态，free 会再报一个"recursive use"，盖掉真正的错误：吞掉
      try { r.free(); } catch { /* 已经坏了 */ }
    }
  }

  /** 画一张 SVG；resvg 内部出错时找出是哪几处滤镜引起的（crash-filters.ts），这几处按没有效果画，记警告 */
  async function renderSafe(p: PaintSvg, width: number, res: PaintResources, warnings: string[], background?: string): Promise<RgbaImage> {
    try {
      return await render(p, width, res, warnings, background);
    } catch (e) {
      crashes++;
      const found = await dropCrashingFilters(p.svg, async (svg) => {
        const w: string[] = [];
        try {
          return { img: await render({ ...p, svg }, width, res, w, background), w };
        } catch {
          crashes++;
          return undefined;
        }
      });
      if (!found) throw e;
      const lit = lightingFilters(p.svg);
      const what = found.dropped.some((id) => lit.has(id)) ? '棱台效果' : '效果（阴影、发光等）';
      warnings.push(...found.result.w, `整页图里有 ${found.dropped.length} 处${what}画不出来，这几处按没有效果画：${(e as Error).message}`);
      return found.result.img;
    }
  }

  async function page(job: PaintJob, res: PaintResources, warnings: string[], layerWarnings: string[]): Promise<RgbaImage> {
    if (job.template) {
      const id = job.template;
      const bg = await layers.get(id, async () => {
        const t = await res.template(id);
        return t && renderSafe(t, job.picWidth, res, layerWarnings, '#ffffff');
      });
      // 取不到背景层时不能只画本页内容（会少了背景）：报错，这一页不出图
      if (!bg) throw new Error('背景层画不出来');
      const out = composite(await renderSafe(job.main, job.picWidth, res, warnings), bg);
      if (!out) throw new Error('背景层和本页内容大小不一样');
      return out;
    }
    return renderSafe(job.main, job.picWidth, res, warnings, '#ffffff');
  }

  return {
    async paint(job, res) {
      if (job.conv !== conv) {
        conv = job.conv;
        fonts = new Map();
        layers = new TemplateCache();
        rasters = new Map();
        uris = new Map();
        urisLength = 0;
      }
      const warnings: string[] = [], layerWarnings: string[] = [];
      const layer = () => (layerWarnings.length ? { layerWarnings } : {});
      let img: RgbaImage;
      try {
        img = await page(job, res, warnings, layerWarnings);
      } catch (e) {
        return { warnings: [...warnings, `整页图画不出来：${(e as Error).message}`], ...layer() };
      }
      // 编码器（libjpeg-turbo WASM）第一次用时初始化；出过错会重新初始化，所以每页都重新取
      let encode: JpegEncode;
      try {
        encode = await jpegEncoder();
      } catch (e) {
        return { warnings: [`JPEG 编码器加载失败，不输出整页图和缩略图：${(e as Error).message}`], ...layer() };
      }
      const out: PaintResult = { warnings, ...layer() };
      const thumb = shrink(img, job.thumbWidth, job.thumbHeight);
      for (const [key, im] of [['pic', img], ['thum', thumb]] as const) {
        try {
          const jpg = encode(im.data, im.width, im.height, JPEG_QUALITY);
          if (jpg) out[key] = jpg;
          else warnings.push(`图片太小（${im.width}×${im.height}），JPEG 编码器放不下，不输出`);
        } catch (e) {
          warnings.push(`JPEG 编码失败，不输出：${(e as Error).message}`);
        }
      }
      return out;
    },
  };
}

/**
 * 换掉页面里的图片地址：resvg 只把 http(s) 地址报成"待解析图片"，media/…、共享图片编号换成占位地址（real：占位地址 -> 原地址），
 * 再按占位地址把原图交给它；<pattern> 里的图片 resvg 不报（实测：图片填充、背景图都画成空白），直接内联成 data URI。
 * 一遍拼出来：大图（几十 MB 的 data URI）只复制一次
 */
async function imageHrefs(svg: string, dataUri: (href: string) => Promise<string | undefined>): Promise<{ svg: string; real: Map<string, string> }> {
  const real = new Map<string, string>();
  const patterns = [...svg.matchAll(/<pattern\b[\s\S]*?<\/pattern>/g)].map((m) => [m.index!, m.index! + m[0].length]);
  const parts: string[] = [];
  let last = 0;
  for (const m of svg.matchAll(/(<image\b[^>]*?\s(?:xlink:)?href=")([^"#][^"]*)"/g)) {
    const href = m[2];
    if (href.startsWith('data:')) continue;
    const at = m.index! + m[1].length;
    let to = patterns.some(([s, e]) => m.index! > s && at < e) ? await dataUri(href) : undefined;
    if (!to) {
      to = `https://unppt.local/${real.size}`;
      real.set(to, href);
    }
    parts.push(svg.slice(last, at), to);
    last = at + href.length;
  }
  parts.push(svg.slice(last));
  return { svg: parts.join(''), real };
}

function mimeOf(b: Uint8Array): string {
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49) return 'image/webp';
  return 'image/svg+xml';
}

/** 区域平均缩小（整页图是不透明的，不用按透明度加权） */
function shrink(img: RgbaImage, w: number, h: number): RgbaImage {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * img.height) / h), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * img.height) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * img.width) / w), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * img.width) / w));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const o = (yy * img.width + xx) * 4;
        r += img.data[o]; g += img.data[o + 1]; b += img.data[o + 2]; n++;
      }
      const o = (y * w + x) * 4;
      out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n); out[o + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}
