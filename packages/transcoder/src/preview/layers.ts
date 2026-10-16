/**
 * 出图的背景层缓存（只用于整页图，不改播放器产物）：同一个母版、版式的背景（背景图、装饰形状、它们的阴影）每页都一样，
 * 不必每页重画。页面根层级里排在第一个本页形状（带 data-uid 的 g，见 render/box.ts withUid）之前的是背景段；
 * 背景段原文和它引用到的定义（渐变、滤镜、裁剪路径、图案……，顺着引用链找全）都相同的页，背景只画一次存成位图，
 * 之后每页只在透明画布上画本页的内容，再按"源在上"叠到背景上。
 * 和整页一次画完相比只有取整差别（每个通道最多差 1~2）。拿不准时（背景段和本页内容互相引用对方定义的 id、切不开）就整页一次画完。
 */
import { definedIds, referencedIds, rootChildren, topElements } from './svg-root';

/** 位图（resvg 画出来的 RGBA） */
interface RgbaImage { width: number; height: number; data: Uint8Array }

export interface TemplateSplit {
  /** 缓存键：背景段原文 + 它用到的定义的原文 */
  key: string;
  /** 只有背景段的整页 SVG（不透明，画的时候垫白底） */
  template: string;
  /** 只有本页内容的整页 SVG（画在透明画布上） */
  page: string;
}

/** 把页面切成背景段和本页内容；没有值得缓存的背景（只有一个底色矩形或者为空）、或者拿不准时返回 undefined */
export function splitTemplate(svg: string): TemplateSplit | undefined {
  const root = rootChildren(svg);
  if (!root) return undefined;
  const isDefs = (k: string) => /^<defs\b/.test(k);
  const defs = root.kids.filter(isDefs);
  const shapes = root.kids.filter((k) => !isDefs(k) && !/^<style\b/.test(k));
  if (root.kids.some((k) => /^<style\b/.test(k))) return undefined;
  const first = shapes.findIndex((k) => /^<g data-uid="/.test(k));
  if (first < 0) return undefined;
  const prefix = shapes.slice(0, first), rest = shapes.slice(first);
  // 只有纯色底（一个不引用图案、渐变的矩形）不值得：缓存和叠加比直接画还贵；图片背景（fill="url(#…)"）正是最贵的
  if (!prefix.length || (prefix.length === 1 && /^<rect\b[^>]*\/>$/.test(prefix[0]) && !/url\(#/.test(prefix[0]))) return undefined;
  const pre = prefix.join(''), own = rest.join('');
  // 背景段里自己定义、本页内容引用的 id（或者反过来）：两边分开画就找不到了
  const preIds = definedIds(pre), ownIds = definedIds(own);
  for (const id of referencedIds(own)) if (preIds.has(id)) return undefined;
  for (const id of referencedIds(pre)) if (ownIds.has(id)) return undefined;
  // defs 里每个定义按 id 找；背景段用到的定义（连带它们再引用的）原文都放进缓存键：不同页同一个 id 可能是不同的定义
  const byId = new Map<string, string>();
  for (const d of defs) {
    const inner = topElements(d.replace(/^<defs\b[^>]*>/, '').replace(/<\/defs>$/, ''));
    if (!inner) return undefined;
    for (const e of inner) {
      const id = /^<[\w:.-]+\b[^>]*?\sid="([^"]+)"/.exec(e)?.[1];
      if (id) byId.set(id, e);
    }
  }
  const used: string[] = [], seen = new Set<string>();
  const visit = (s: string) => {
    for (const id of referencedIds(s)) {
      if (seen.has(id)) continue;
      seen.add(id);
      const e = byId.get(id);
      if (e) { used.push(e); visit(e); }
    }
  };
  visit(pre);
  const head = root.open + defs.join('');
  // 定义的 id 带页号（common/svg.ts SvgDoc：u{页号}_类型计数，计数每页从 0 开始、背景段最先写），比较时把页号去掉，
  // 只改 id、url(#…)、href="#…" 这几处，不碰文字内容
  const key = `${root.open}\u0000${pre}\u0000${used.join('')}`.replace(/(\sid="|url\(#|\s(?:xlink:)?href="#)u\d+_/g, '$1u_');
  return { key, template: head + pre + root.close, page: head + own + root.close };
}

/** 预乘透明度的前景叠到不透明的背景上（源在上）；尺寸不一样时返回 undefined */
export function composite(fg: RgbaImage, bg: RgbaImage): RgbaImage | undefined {
  if (fg.width !== bg.width || fg.height !== bg.height) return undefined;
  const out = new Uint8Array(bg.data);
  const f = fg.data;
  for (let i = 0; i < f.length; i += 4) {
    const a = f[i + 3];
    if (a === 0) continue;
    if (a === 255) { out[i] = f[i]; out[i + 1] = f[i + 1]; out[i + 2] = f[i + 2]; continue; }
    const k = 255 - a;
    for (let c = 0; c < 3; c++) {
      const x = out[i + c] * k + 128;
      // 实测：resvg 缩放图片时边缘半透明像素的颜色偶尔比不透明度略大（不满足预乘的约束），相加会超过 255，要截断，不然变成黑点
      const v = f[i + c] + ((x + (x >> 8)) >> 8);
      out[i + c] = v > 255 ? 255 : v;
    }
  }
  return { width: bg.width, height: bg.height, data: out };
}

/** 背景层位图缓存：按字节数淘汰最久没用的（默认 64MB，1920×1080 的背景每张约 8MB） */
export class TemplateCache {
  private layers = new Map<string, Promise<RgbaImage | undefined>>();
  private sizes = new Map<string, number>();
  private total = 0;

  constructor(private maxBytes = 64 * 1024 * 1024) {}

  /** 背景层位图；没有缓存时用 paint 画一张 */
  get(key: string, paint: () => Promise<RgbaImage | undefined>): Promise<RgbaImage | undefined> {
    let p = this.layers.get(key);
    if (p) {
      // 最近用过的挪到最后
      this.layers.delete(key);
      this.layers.set(key, p);
      return p;
    }
    p = paint().then((img) => {
      if (!img) { this.drop(key); return undefined; }
      this.sizes.set(key, img.data.length);
      this.total += img.data.length;
      for (const k of this.layers.keys()) {
        if (this.total <= this.maxBytes || k === key) break;
        this.drop(k);
      }
      return img;
    }, (e: unknown) => {
      // 画失败的不留在缓存里，下次重画
      this.drop(key);
      throw e;
    });
    this.layers.set(key, p);
    return p;
  }

  private drop(key: string) {
    this.layers.delete(key);
    this.total -= this.sizes.get(key) ?? 0;
    this.sizes.delete(key);
  }
}
