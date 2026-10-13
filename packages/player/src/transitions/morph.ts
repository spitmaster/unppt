/**
 * 平滑切换（Morph）：前后两页里同名（data-name）的顶层对象从旧位置、旧大小平滑变到新位置、新大小，
 * 新旧两份交叉淡化（颜色、字号的变化近似成渐变）；新页其余内容逐个淡入，盖住旧页。
 * 同一页里重名时按出现顺序一一配对；还没出现（等进入动画）或已经退出的对象不参与配对。
 */
import type { TransitionEffect } from './transition';

interface Rect { x: number; y: number; w: number; h: number }

/** 顶层对象（不在别的动画目标里面），按名字分组 */
function named(root: HTMLElement): Map<string, SVGGraphicsElement[]> {
  const m = new Map<string, SVGGraphicsElement[]>();
  for (const e of Array.from(root.querySelectorAll<SVGGraphicsElement>('[data-name]'))) {
    if (e.parentElement?.closest('[data-uid]')) continue;
    const k = e.getAttribute('data-name') ?? '';
    const list = m.get(k);
    if (list) list.push(e);
    else m.set(k, [e]);
  }
  return m;
}

function box(e: SVGGraphicsElement): Rect | undefined {
  if (e.closest('.unppt-hide')) return undefined;
  try {
    const b = e.getBBox();
    return b.width || b.height ? { x: b.x, y: b.y, w: b.width, h: b.height } : undefined;
  } catch {
    return undefined;
  }
}

/** 把 from 框变成 to 框的 CSS 变换（变换原点是元素自己的中心，见 css.ts 里 [data-uid] 的 transform-box） */
function mapBox(from: Rect, to: Rect): string {
  const sx = from.w ? to.w / from.w : 1, sy = from.h ? to.h / from.h : 1;
  const dx = to.x + to.w / 2 - (from.x + from.w / 2), dy = to.y + to.h / 2 - (from.y + from.h / 2);
  return `translate(${dx}px,${dy}px) scale(${sx},${sy})`;
}

/** 新页里除了配对对象以外的内容逐个淡入；配对对象所在的外层（比如超链接）往里拆开 */
function fadeIn(parent: Element, pairs: Set<Element>, anims: Animation[], timing: KeyframeAnimationOptions) {
  for (const c of Array.from(parent.children)) {
    if (c.localName === 'defs' || pairs.has(c)) continue;
    if (Array.from(pairs).some((p) => c.contains(p))) { fadeIn(c, pairs, anims, timing); continue; }
    // 隐藏的（等进入动画）和正在播进入动画的对象交给动画引擎
    if (c.closest('.unppt-hide') || c.getAnimations().length) continue;
    anims.push(c.animate([{ opacity: 0 }, { opacity: 1 }], timing));
  }
}

export const morph: TransitionEffect = {
  type: 'morph',
  run(old, el, _t, dur) {
    const timing: KeyframeAnimationOptions = { duration: dur, easing: 'ease-in-out' };
    const before = named(old);
    const anims: Animation[] = [];
    const moved: Element[] = [];
    const pairs = new Set<Element>();
    for (const [name, news] of named(el)) {
      const olds = before.get(name) ?? [];
      news.forEach((n, i) => {
        const o = olds[i];
        const ob = o && box(o), nb = box(n);
        if (!o || !ob || !nb) return;
        pairs.add(n);
        // 旧对象挪进新页、紧贴在新对象下面：两份直接交叉淡化，中间不隔着新页背景
        n.parentNode?.insertBefore(o, n);
        moved.push(o);
        pairs.add(o);
        anims.push(o.animate([{ transform: 'none' }, { transform: mapBox(ob, nb) }], timing));
        anims.push(n.animate([{ transform: mapBox(nb, ob), opacity: 0 }, { transform: 'none', opacity: 1 }], timing));
      });
    }
    const svg = el.querySelector('svg');
    if (svg) fadeIn(svg, pairs, anims, timing);
    // 承载动画：它结束（或被跳到结束）时，所有对象动画一起结束，挪过来的旧对象移除
    const carrier = el.animate([{ opacity: 1 }, { opacity: 1 }], { duration: dur });
    const done = () => {
      for (const a of anims) {
        try { a.finish(); } catch { a.cancel(); }
      }
      for (const m of moved) m.remove();
    };
    carrier.addEventListener('finish', done);
    carrier.addEventListener('cancel', done);
    return carrier;
  },
};
