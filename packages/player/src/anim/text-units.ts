/**
 * 文字逐字 / 逐词动画：把元素里的文字拆成一个个 tspan，按间隔依次淡入（退出时依次淡出）。
 * tspan 不支持位移，所以飞入等效果也统一按淡入处理；元素本身的填充和边框随第一个字出现。
 */
import type { AnimAction } from '../../../format/src/index';

/** 播放时需要的管理能力：登记正在播的动画、登记翻页时要清理的事 */
export interface AnimHost {
  track(a: Animation): void;
  cleanupLater(fn: () => void): void;
}

export class TextUnits {
  /** 拆出的文字单元（只拆一次，结果记在元素上） */
  private cache = new WeakMap<Element, { by: string; units: Element[] }>();

  /** 没有文字或浏览器不支持 Web Animations 时返回 false，由调用方按整个元素播放 */
  play(el: Element, a: AnimAction, host: AnimHost): boolean {
    const units = this.split(el, a.iterate!.by);
    if (!units.length || typeof (el as HTMLElement).animate !== 'function') return false;
    if (a.dir === 'in' && a.delay) {
      el.classList.add('unppt-hide');
      const t = setTimeout(() => el.classList.remove('unppt-hide'), a.delay);
      host.cleanupLater(() => { clearTimeout(t); el.classList.remove('unppt-hide'); });
    }
    const show = a.dir === 'in';
    const anims: Animation[] = [];
    units.forEach((u, i) => {
      const o0 = show ? 0 : 1, o1 = show ? 1 : 0;
      const frames = a.effect === 'appear' || !a.dur
        ? [{ fillOpacity: o0, strokeOpacity: o0 }, { fillOpacity: o0, strokeOpacity: o0, offset: 0.999 }, { fillOpacity: o1, strokeOpacity: o1 }]
        : [{ fillOpacity: o0, strokeOpacity: o0 }, { fillOpacity: o1, strokeOpacity: o1 }];
      const anim = u.animate(frames, { duration: Math.max(1, a.dur), delay: a.delay + i * a.iterate!.gap, fill: show ? 'backwards' : 'forwards' });
      anims.push(anim);
      host.track(anim);
    });
    if (!show) {
      // 最后一个字消失后隐藏整个元素，并撤掉"保持透明"的动画，以免以后再次进入时还是透明的
      const done = () => { el.classList.add('unppt-hide'); for (const x of anims) x.cancel(); };
      const last = anims[anims.length - 1];
      last.addEventListener('finish', done);
      last.addEventListener('cancel', () => el.classList.add('unppt-hide'));
    }
    return true;
  }

  private split(el: Element, by: 'letter' | 'word'): Element[] {
    const cached = this.cache.get(el);
    if (cached && cached.by === by) return cached.units;
    const doc = el.ownerDocument;
    const units: Element[] = [];
    for (const text of Array.from(el.querySelectorAll('text'))) {
      const walker = doc.createTreeWalker(text, 4 /* NodeFilter.SHOW_TEXT */);
      const nodes: Text[] = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
      for (const node of nodes) {
        const str = node.data;
        if (!str) continue;
        const parts = by === 'letter' ? Array.from(str) : str.match(/\S+\s*|\s+/g) ?? [str];
        const frag = doc.createDocumentFragment();
        for (const part of parts) {
          const t = doc.createElementNS('http://www.w3.org/2000/svg', 'tspan');
          t.textContent = part;
          frag.appendChild(t);
          if (part.trim()) units.push(t);
        }
        node.parentNode!.replaceChild(frag, node);
      }
    }
    this.cache.set(el, { by, units });
    return units;
  }
}
