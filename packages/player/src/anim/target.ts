/** 强调和路径动画：在元素当前的累计状态上应用终态（缩放、旋转、移动、透明度、颜色），可选带过渡 */
import type { AnimTarget } from '../../../format/src/index';

export interface TransformState { tx: number; ty: number; sx: number; sy: number; rot: number }

const IDENTITY: TransformState = { tx: 0, ty: 0, sx: 1, sy: 1, rot: 0 };

function transformOf(st: TransformState) {
  return `translate(${st.tx}px,${st.ty}px) rotate(${st.rot}deg) scale(${st.sx},${st.sy})`;
}

/** 应用强调动画的最终状态；animate 为真时做过渡（动画交给 track 统一管理） */
export function applyTarget(
  el: Element, to: AnimTarget, animate: boolean, dur: number, delay: number,
  states: Map<Element, TransformState>, track: (a: Animation) => void,
) {
  const cur = states.get(el) ?? IDENTITY;
  const next = { ...cur };
  if (to.move) { next.tx += to.move[0]; next.ty += to.move[1]; }
  if (to.scale) { next.sx *= to.scale[0]; next.sy *= to.scale[1]; }
  if (to.rotate) next.rot += to.rotate;
  states.set(el, next);
  const h = el as HTMLElement;
  const canAnimate = animate && typeof h.animate === 'function' && dur > 0;
  if (to.move || to.scale || to.rotate || to.keys) {
    const from = transformOf(cur), end = transformOf(next);
    h.style.transform = end;
    if (canAnimate && to.keys && to.keys.length > 1) {
      // 脉冲、跷跷板这类过程有往返的强调动画：按采样的关键帧播放
      const frames = to.keys.map((k) => ({ transform: transformOf({ ...cur, sx: cur.sx * k.s[0], sy: cur.sy * k.s[1], rot: cur.rot + k.r }), offset: k.o }));
      frames[frames.length - 1].transform = end;
      track(h.animate(frames, { duration: dur, delay, fill: 'backwards' }));
    } else if (canAnimate && to.path && to.path.length > 2) {
      // 沿路径移动：按累计长度分配关键帧，速度均匀，整体缓入缓出
      const lens = [0];
      for (let i = 1; i < to.path.length; i++) lens.push(lens[i - 1] + Math.hypot(to.path[i][0] - to.path[i - 1][0], to.path[i][1] - to.path[i - 1][1]));
      const total = lens[lens.length - 1] || 1;
      const frames = to.path.map((p, i) => ({ transform: transformOf({ ...next, tx: cur.tx + p[0], ty: cur.ty + p[1] }), offset: lens[i] / total }));
      frames[0].transform = from;
      frames[frames.length - 1].transform = end;
      track(h.animate(frames, { duration: dur, delay, easing: 'ease-in-out', fill: 'backwards' }));
    } else if (canAnimate) track(h.animate([{ transform: from }, { transform: end }], { duration: dur, delay, easing: 'ease-in-out', fill: 'backwards' }));
  }
  if (to.opacity !== undefined) {
    const from = h.style.opacity || '1';
    h.style.opacity = String(to.opacity);
    if (canAnimate) track(h.animate([{ opacity: from }, { opacity: String(to.opacity) }], { duration: dur, delay, fill: 'backwards' }));
  }
  const recolor = (sel: string, color: string) => {
    for (const node of Array.from(el.querySelectorAll(sel))) {
      const n = node as SVGElement;
      const f = n.getAttribute('fill');
      if (!f || f === 'none' || f.startsWith('url(')) continue;
      const from = n.style.fill || f;
      n.style.fill = color;
      if (canAnimate && typeof n.animate === 'function') track(n.animate([{ fill: from }, { fill: color }], { duration: dur, delay, fill: 'backwards' }));
    }
  };
  if (to.fill) recolor('path,rect,ellipse,circle,polygon', to.fill);
  if (to.color) recolor('text', to.color);
}
