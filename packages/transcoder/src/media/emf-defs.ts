/**
 * EMF -> SVG 的定义（emf.ts）：相同的裁剪区域只定义一次；同一张位图用到两次以上时只嵌入一次，各处引用它。
 * 实测样本里有 EMF 把同一张小位图贴了 512 次、裁剪区域定义了 2.5 万次（不同的只有 208 个）：转出来的 SVG 有 59MB，
 * resvg 画这一页要 98 秒，浏览器加载也慢。只用一次的位图照旧直接写（输出不变）。
 */
const f2 = (v: number) => (Math.round(v * 100) / 100).toString();

/** 只画位图的一部分：源框（x、y 从位图左上角算，像素）和位图的宽高 */
export interface BitmapSource { x: number; y: number; w: number; h: number; bw: number; bh: number }

interface Bitmap { href: string; x: number; y: number; w: number; h: number; attrs: string; src?: BitmapSource }

export class EmfDefs {
  readonly defs: string[] = [];
  private clips = new Map<string, string>();
  private bitmaps: Bitmap[] = [];

  constructor(private id: (prefix: string) => string) {}

  /** 裁剪区域：内容（连同嵌套的上一层裁剪）相同的共用一个 id */
  clip(content: string, parent?: string): string {
    const key = `${parent ?? ''}\u0000${content}`;
    let id = this.clips.get(key);
    if (!id) {
      id = this.id('c');
      this.clips.set(key, id);
      this.defs.push(`<clipPath id="${id}"${parent ? ` clip-path="url(#${parent})"` : ''}>${content}</clipPath>`);
    }
    return id;
  }

  /** 位图：先放占位符，finish 时按用到的次数决定直接写还是引用；attrs 是透明度、裁剪等其它属性；src 给了时只画源框里的部分 */
  bitmap(href: string, x: number, y: number, w: number, h: number, attrs: string, src?: BitmapSource): string {
    this.bitmaps.push({ href, x, y, w, h, attrs, ...(src ? { src } : {}) });
    return `\u0000unppt-bitmap-${this.bitmaps.length - 1}\u0000`;
  }

  /** 把内容里的位图占位符换掉（用到两次以上的位图放进 defs） */
  finish(body: string): string {
    if (!this.bitmaps.length) return body;
    const count = new Map<string, number>();
    for (const b of this.bitmaps) count.set(b.href, (count.get(b.href) ?? 0) + 1);
    const ids = new Map<string, string>();
    return body.replace(/\u0000unppt-bitmap-(\d+)\u0000/g, (_, k: string) => {
      const b = this.bitmaps[Number(k)];
      // 只画一部分：外面套一层 <svg>，viewBox 是源框，里面按位图原尺寸放
      const s = b.src;
      const part = (inner: string) => `<g${b.attrs}><svg x="${f2(b.x)}" y="${f2(b.y)}" width="${f2(b.w)}" height="${f2(b.h)}" viewBox="${s!.x} ${s!.y} ${s!.w} ${s!.h}" preserveAspectRatio="none">${inner}</svg></g>`;
      if (count.get(b.href) === 1) {
        if (s) return part(`<image href="${b.href}" width="${s.bw}" height="${s.bh}" preserveAspectRatio="none"/>`);
        return `<image href="${b.href}" x="${f2(b.x)}" y="${f2(b.y)}" width="${f2(b.w)}" height="${f2(b.h)}" preserveAspectRatio="none"${b.attrs}/>`;
      }
      let id = ids.get(b.href);
      if (!id) {
        id = this.id('b');
        ids.set(b.href, id);
        // 1×1 的位图，各处用变换拉到自己的位置大小；裁剪、透明度放在外面的 g 上（和位图在同一个坐标系）
        this.defs.push(`<image id="${id}" href="${b.href}" width="1" height="1" preserveAspectRatio="none"/>`);
      }
      if (s) return part(`<use href="#${id}" transform="matrix(${s.bw} 0 0 ${s.bh} 0 0)"/>`);
      return `<g${b.attrs}><use href="#${id}" transform="matrix(${f2(b.w)} 0 0 ${f2(b.h)} ${f2(b.x)} ${f2(b.y)})"/></g>`;
    });
  }
}

/**
 * 连续用同一个裁剪区域的元素（两个以上）收进一个 <g clip-path>：画出来一样（只有裁剪边缘半透明的像素有取整差别），
 * resvg 和浏览器都只做一次裁剪。实测样本里一张 EMF 转出 47 万条路径、几乎每条各带裁剪：resvg 画 253 秒，不带裁剪 0.2 秒。
 * parts 是一个个顶层元素；只看元素自己开始标签里的 clip-path
 */
export function groupClips(parts: string[]): string {
  const out: string[] = [];
  let run: string[] = [], plain: string[] = [], clip: string | undefined;
  const flush = () => {
    if (run.length > 1) out.push(`<g clip-path="url(#${clip})">${plain.join('')}</g>`);
    else out.push(...run);
    run = []; plain = []; clip = undefined;
  };
  for (const p of parts) {
    const m = /^(<[\w:-]+\b[^>]*?) clip-path="url\(#([^)"]+)\)"/.exec(p);
    if (!m) { flush(); out.push(p); continue; }
    if (m[2] !== clip) flush();
    clip = m[2];
    run.push(p);
    plain.push(m[1] + p.slice(m[0].length));
  }
  flush();
  return out.join('');
}
