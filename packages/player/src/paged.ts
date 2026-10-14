/**
 * 按需加载的演示数据（paged / pages 形式）：入口 HTML 里只有目录，每页数据是单独的脚本文件，
 * 用 <script> 标签加载（不用 fetch：本地 file:// 打开、跨域托管都能用），脚本加载后调用 __unpptPage(页号, 数据)。
 * 页面数据到了以后顺便预取它引用的图片，翻到这页时图片已经在浏览器缓存里。
 */
import { FONT_CALLBACK, PAGE_CALLBACK, type DeckIndex, type DeckSlide } from '../../format/src/index';
import { loadFonts, type DeckLike } from './deck';

/** 同时留在内存里的页数（当前页、预加载的页和最近看过的几页） */
const KEEP = 12;

export function pagedDeck(doc: Document, index: DeckIndex): DeckLike {
  const win = doc.defaultView as unknown as Record<string, unknown>;
  const loaded = new Map<number, DeckSlide>();
  const waiting = new Map<number, Promise<void>>();
  const resolvers = new Map<number, () => void>();
  win[PAGE_CALLBACK] = (i: number, data: DeckSlide) => {
    loaded.delete(i);
    loaded.set(i, data);
    // 太多了从最早加载的开始丢（要看时重新加载，浏览器缓存里还有）
    while (loaded.size > KEEP) loaded.delete(loaded.keys().next().value as number);
    resolvers.get(i)?.();
    preloadImages(doc, data.svg);
  };
  // 字体：每个字体一个脚本，一开始全部开始加载（不挡住页面显示，到了浏览器自动重绘）
  const fontInfo = new Map(index.fonts.map((f) => [f.family, f]));
  win[FONT_CALLBACK] = (family: string, b64: string) => {
    const f = fontInfo.get(family);
    loadFonts(doc, [{ family, weight: f?.weight, style: f?.style, src: `data:font/woff;base64,${b64}` }]);
  };
  for (const f of index.fonts) if (f.url) addScript(doc, f.url).catch(() => {});

  return {
    ...index,
    slideCount: index.pages.length,
    skip: (i) => !!index.pages[i]?.skip,
    ready: (i) => loaded.has(i),
    slide(i) {
      const s = loaded.get(i);
      if (!s) throw new Error(`第 ${i + 1} 页还没加载`);
      return s;
    },
    load(i) {
      if (loaded.has(i)) return Promise.resolve();
      let p = waiting.get(i);
      if (!p) {
        const page = index.pages[i];
        if (!page) return Promise.reject(new Error(`没有第 ${i + 1} 页`));
        p = new Promise<void>((ok, fail) => {
          resolvers.set(i, ok);
          addScript(doc, page.file).catch(fail);
        }).finally(() => { waiting.delete(i); resolvers.delete(i); });
        waiting.set(i, p);
      }
      return p;
    },
  };
}

function addScript(doc: Document, src: string): Promise<void> {
  return new Promise((ok, fail) => {
    const s = doc.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => { s.remove(); ok(); };
    s.onerror = () => { s.remove(); fail(new Error(`加载失败：${src}`)); };
    doc.head.appendChild(s);
  });
}

/** 预取页面里引用的图片文件（media/ 下的） */
function preloadImages(doc: Document, svg: string) {
  const Img = (doc.defaultView as unknown as { Image?: typeof Image }).Image;
  if (!Img) return;
  for (const m of svg.matchAll(/href="(media\/[^"]+\.(?:png|jpe?g|gif|bmp|svg|webp|ico))"/g)) new Img().src = m[1];
}
