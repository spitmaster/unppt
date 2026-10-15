/**
 * 启动：
 * 1. 转码出来的 HTML 里自动启动：single 形式读取页面里的 #unppt-meta 和 script.unppt-slide，按需解析每页；
 *    按需加载的形式（paged / pages）读取 #unppt-index（目录），每页数据另外加载（paged.ts）；
 * 2. 单独部署：mount(元素, deck 对象, 选项)，deck 对象由宿主自己加载。
 */
import type { DeckSlide } from '../../format/src/index';
import { installBridge, type UnpptApi } from './bridge';
import { Player, type MountOptions } from './core/player';
import { checkFormat, inlineDeck, loadFonts, type DeckLike } from './deck';
import { pagedDeck } from './paged';

/** 单独部署时使用：mount(元素, deck 对象) */
export function mount(el: HTMLElement, deck: { format: string; version: number; width: number; height: number; slides: DeckSlide[]; title?: string; fonts?: { family: string; weight?: string; style?: string; url?: string }[] }, opts: MountOptions & { baseUrl?: string } = {}): Player {
  checkFormat(deck);
  // 只输出数据时，字体和媒体是相对 deck.json 的路径
  const base = opts.baseUrl ?? '';
  loadFonts(el.ownerDocument, (deck.fonts ?? []).filter((f) => f.url).map((f) => ({ family: f.family, weight: f.weight, style: f.style, src: base + f.url })));
  return new Player(el, inlineDeck({ ...deck, slideCount: deck.slides.length, slide: (i) => deck.slides[i] }), opts);
}

function readParams(win: Window) {
  const q = new URLSearchParams(win.location.search);
  const num = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined);
  const origins = q.get('origin');
  return {
    slide: num('slide'), step: num('step'),
    ui: q.get('ui') !== '0',
    // 观看模式：只由 JS 接口驱动（直播课的学生端）
    mode: q.get('mode') === 'watch' ? 'watch' as const : 'present' as const,
    // links=0：外部链接不自己打开，只发 link 事件（由宿主决定，比如先提示）
    openLinks: q.get('links') !== '0',
    // 自动放映：timings=0/1 指定；没指定时，用 slide/step 打开到某个位置（截图、预览）不自动往下走
    timings: q.get('timings') === '1' ? true : q.get('timings') === '0' || q.has('slide') || q.has('step') ? false : undefined,
    origins: origins ? origins.split(',').map((s) => s.trim()).filter(Boolean) : null,
  };
}

export function autoBoot() {
  const doc = typeof document !== 'undefined' ? document : undefined;
  const metaEl = doc?.getElementById('unppt-meta');
  const indexEl = doc?.getElementById('unppt-index');
  const host = doc?.getElementById('unppt');
  if (!doc || !(metaEl || indexEl) || !host) return;
  const win = doc.defaultView!;
  doc.documentElement.style.height = '100%';
  doc.body.style.cssText += ';margin:0;height:100%;background:#000';
  host.style.cssText += ';width:100%;height:100%';
  try {
    const deck = indexEl ? indexDeck(doc, indexEl) : embeddedDeck(doc, metaEl!);
    const p = readParams(win);
    const player = new Player(host, deck, { slide: p.slide, step: p.step, ui: p.ui, timings: p.timings, mode: p.mode, openLinks: p.openLinks });
    const api = installBridge(win, player, p.origins);
    (win as unknown as { unppt: UnpptApi }).unppt = api;
  } catch (e) {
    host.innerHTML = `<div class="unppt-error">无法播放：${(e as Error).message}</div>`;
  }
}

/** 按需加载的形式：目录在 #unppt-index */
function indexDeck(doc: Document, el: Element): DeckLike {
  const index = JSON.parse(el.textContent ?? '{}');
  checkFormat(index);
  return pagedDeck(doc, index);
}

/** single 形式：页面数据都在 HTML 里 */
function embeddedDeck(doc: Document, metaEl: Element): DeckLike {
  const meta = JSON.parse(metaEl.textContent ?? '{}');
  checkFormat(meta);
  const scripts = Array.from(doc.querySelectorAll('script.unppt-slide'));
  const assetEls = new Map<string, Element>();
  for (const el of Array.from(doc.querySelectorAll('script.unppt-asset'))) assetEls.set(el.getAttribute('data-id') ?? '', el);
  const assetCache = new Map<string, string>();
  const asset = (id: string) => {
    let v = assetCache.get(id);
    if (v === undefined) {
      v = JSON.parse(assetEls.get(id)?.textContent ?? '""') as string;
      assetCache.set(id, v);
    }
    return v;
  };
  const cache = new Map<number, DeckSlide>();
  const deck = inlineDeck({
    ...meta,
    slideCount: scripts.length,
    slide(i: number) {
      let s = cache.get(i);
      if (!s) {
        s = JSON.parse(scripts[i].textContent ?? '{}') as DeckSlide;
        // 共享图片：把 unppt:asset/编号 换成真正的数据
        s.svg = s.svg.replace(/unppt:asset\/(\d+)/g, (_m, id: string) => asset(id));
        // 只缓存附近几页，几百页的大文件也不会占太多内存
        if (cache.size > 8) cache.delete(cache.keys().next().value as number);
        cache.set(i, s);
      }
      return s;
    },
  });
  const fontEls = Array.from(doc.querySelectorAll('script.unppt-font'));
  const metaFonts: { family: string; weight?: string; style?: string }[] = meta.fonts ?? [];
  loadFonts(doc, fontEls.map((el) => {
    const family = el.getAttribute('data-family') ?? '';
    const m = metaFonts.find((f) => f.family === family);
    return { family, weight: m?.weight, style: m?.style, src: `data:font/woff;base64,${JSON.parse(el.textContent ?? '""')}` };
  }));
  return deck;
}
