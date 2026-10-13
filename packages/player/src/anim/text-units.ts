/**
 * 文字逐字 / 逐词动画。按效果分两种拆法：
 *   - 只改透明度的效果（淡入、出现）：把文字拆成 tspan，按间隔依次改透明度；
 *   - 带位移、缩放、裁剪的效果（飞入、缩放、擦除……）：tspan 不能单独变换，
 *     就按浏览器排好的每个字的起点，把每个字（词）拆成单独摆放的 <text>，各自播放整段效果的关键帧。
 * 元素本身的填充和边框随第一个字出现。
 */
import type { AnimAction } from '../../../format/src/index';
import { animEffect, effectKeyframes } from './effects/effects';

/** 播放时需要的管理能力：登记正在播的动画、登记翻页时要清理的事、幻灯片尺寸 */
export interface AnimHost {
  track(a: Animation): void;
  cleanupLater(fn: () => void): void;
  readonly slideW: number;
  readonly slideH: number;
}

type Mode = 'tspan' | 'text';

const partsOf = (s: string, by: 'letter' | 'word') => (by === 'letter' ? Array.from(s) : s.match(/\S+\s*|\s+/g) ?? [s]);

/** 拆成 tspan（文字位置不变，只能改透明度这类不影响排版的属性） */
function splitTspans(el: Element, by: 'letter' | 'word'): Element[] {
  const doc = el.ownerDocument;
  const units: Element[] = [];
  for (const text of Array.from(el.querySelectorAll('text'))) {
    const walker = doc.createTreeWalker(text, 4 /* NodeFilter.SHOW_TEXT */);
    const nodes: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
    for (const node of nodes) {
      if (!node.data) continue;
      const frag = doc.createDocumentFragment();
      for (const part of partsOf(node.data, by)) {
        const t = doc.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        t.textContent = part;
        frag.appendChild(t);
        if (part.trim()) units.push(t);
      }
      node.parentNode!.replaceChild(frag, node);
    }
  }
  return units;
}

/** 拆成单独摆放的 <text>：位置取浏览器排版后每个字的起点，所以和原来分毫不差 */
function splitTexts(el: Element, by: 'letter' | 'word'): Element[] {
  const units: Element[] = [];
  for (const text of Array.from(el.querySelectorAll('text')) as SVGTextElement[]) {
    const str = text.textContent ?? '';
    if (!str.trim()) continue;
    const made: SVGTextElement[] = [];
    try {
      let idx = 0;
      for (const part of partsOf(str, by)) {
        if (part.trim()) {
          const p = text.getStartPositionOfChar(idx);
          const t = text.cloneNode(false) as SVGTextElement;
          t.setAttribute('x', String(p.x));
          t.setAttribute('y', String(p.y));
          t.removeAttribute('text-anchor');
          t.textContent = part;
          t.classList.add('unppt-unit');
          made.push(t);
        }
        idx += part.length; // 字的编号按 UTF-16 计
      }
    } catch {
      continue; // 取不到字的位置时这一段整体播放
    }
    for (const t of made) text.parentNode!.insertBefore(t, text);
    text.remove();
    units.push(...made);
  }
  return units;
}

export class TextUnits {
  /** 拆出的文字单元（同一种拆法只拆一次，结果记在元素上） */
  private cache = new WeakMap<Element, { key: string; units: Element[] }>();

  /** 没有文字或浏览器不支持 Web Animations 时返回 false，由调用方按整个元素播放 */
  play(el: Element, a: AnimAction, host: AnimHost): boolean {
    if (typeof (el as HTMLElement).animate !== 'function') return false;
    const effect = animEffect(a.effect);
    const opacityOnly = a.effect === 'appear' || effect.name === 'fade';
    const units = this.units(el, a.iterate!.by, opacityOnly ? 'tspan' : 'text');
    if (!units.length) return false;
    if (a.dir === 'in' && a.delay) {
      el.classList.add('unppt-hide');
      const t = setTimeout(() => el.classList.remove('unppt-hide'), a.delay);
      host.cleanupLater(() => { clearTimeout(t); el.classList.remove('unppt-hide'); });
    }
    const show = a.dir === 'in';
    const anims: Animation[] = [];
    units.forEach((u, i) => {
      let frames: Keyframe[];
      let easing = 'linear';
      if (opacityOnly) {
        const o0 = show ? 0 : 1, o1 = show ? 1 : 0;
        frames = a.effect === 'appear' || !a.dur
          ? [{ fillOpacity: o0, strokeOpacity: o0 }, { fillOpacity: o0, strokeOpacity: o0, offset: 0.999 }, { fillOpacity: o1, strokeOpacity: o1 }]
          : [{ fillOpacity: o0, strokeOpacity: o0 }, { fillOpacity: o1, strokeOpacity: o1 }];
      } else {
        ({ frames, easing } = effectKeyframes(a, u, host.slideW, host.slideH));
      }
      const anim = u.animate(frames, { duration: Math.max(1, a.dur), delay: a.delay + i * a.iterate!.gap, easing, fill: show ? 'backwards' : 'forwards' });
      anims.push(anim);
      host.track(anim);
    });
    if (!show) {
      // 最后一个字消失后隐藏整个元素，并撤掉"保持消失状态"的动画，以免以后再次进入时还是看不见
      const done = () => { el.classList.add('unppt-hide'); for (const x of anims) x.cancel(); };
      const last = anims[anims.length - 1];
      last.addEventListener('finish', done);
      last.addEventListener('cancel', () => el.classList.add('unppt-hide'));
    }
    return true;
  }

  private units(el: Element, by: 'letter' | 'word', mode: Mode): Element[] {
    const key = `${mode}|${by}`;
    const cached = this.cache.get(el);
    if (cached && cached.key === key) return cached.units;
    const units = mode === 'tspan' ? splitTspans(el, by) : splitTexts(el, by);
    this.cache.set(el, { key, units });
    return units;
  }
}
