/** 强调和路径动画：在元素当前的累计状态上应用终态（缩放、旋转、移动、透明度、颜色），可选带过渡 */
import type { AnimTarget } from '../../../format/src/index';
import { easeAccel } from './behaviors';
import { ONCE, type RepeatOptions } from './repeat';

export interface TransformState { tx: number; ty: number; sx: number; sy: number; rot: number }

const IDENTITY: TransformState = { tx: 0, ty: 0, sx: 1, sy: 1, rot: 0 };

function transformOf(st: TransformState) {
  return `translate(${st.tx}px,${st.ty}px) rotate(${st.rot}deg) scale(${st.sx},${st.sy})`;
}

/**
 * 应用强调动画的最终状态；animate 为真时做过渡（动画交给 track 统一管理）。
 * rep 是重复和自动翻转；自动翻转时播完回到原来的状态，累计状态不变。
 */
export function applyTarget(
  el: Element, to: AnimTarget, animate: boolean, dur: number, delay: number,
  states: Map<Element, TransformState>, track: (a: Animation) => void, rep: RepeatOptions = ONCE,
) {
  const back = rep.direction === 'alternate';
  const cur = states.get(el) ?? IDENTITY;
  const next = { ...cur };
  if (to.move) { next.tx += to.move[0]; next.ty += to.move[1]; }
  if (to.scale) { next.sx *= to.scale[0]; next.sy *= to.scale[1]; }
  if (to.rotate) next.rot += to.rotate;
  states.set(el, back ? cur : next);
  const h = el as HTMLElement;
  const canAnimate = animate && typeof h.animate === 'function' && dur > 0;
  const opts = (easing?: string): KeyframeAnimationOptions => ({ duration: dur, delay, fill: 'backwards', ...(easing ? { easing } : {}), ...rep });
  const keyOpacity = !!to.keys?.some((k) => k.a !== undefined);
  const baseOpacity = Number(h.style.opacity || '1');
  if (to.move || to.scale || to.rotate || to.keys) {
    const from = transformOf(cur), end = transformOf(next);
    h.style.transform = back ? from : end;
    // 加减速（平滑开始/结束）按时间采样；没有时匀速（PowerPoint 的行为默认是匀速的）
    const ease = (o: number) => easeAccel(o, to.accel, to.decel);
    const steps = to.accel || to.decel ? 24 : 1;
    if (canAnimate && to.keys && to.keys.length > 1) {
      // 脉冲、跷跷板、带加减速的旋转这类过程不是匀速一次到位的：按采样的关键帧播放
      const frames: Keyframe[] = to.keys.map((k) => ({
        transform: transformOf({ ...cur, sx: cur.sx * k.s[0], sy: cur.sy * k.s[1], rot: cur.rot + k.r }),
        ...(k.a !== undefined ? { opacity: String(baseOpacity * k.a) } : {}),
        offset: k.o,
      }));
      frames[frames.length - 1].transform = end;
      track(h.animate(frames, opts()));
    } else if (canAnimate && to.path && to.path.length > 2) {
      // 沿路径移动：按累计长度匀速，再按加减速分配时间
      const pts = to.path;
      const lens = [0];
      for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const total = lens[lens.length - 1] || 1;
      const at = (d: number): [number, number] => {
        let i = 1;
        while (i < lens.length - 1 && lens[i] < d) i++;
        const seg = lens[i] - lens[i - 1] || 1, u = Math.max(0, Math.min(1, (d - lens[i - 1]) / seg));
        return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u];
      };
      const frames: Keyframe[] = [];
      if (steps > 1) {
        const n = Math.max(24, Math.min(120, pts.length * 2));
        for (let k = 0; k <= n; k++) {
          const [x, y] = at(ease(k / n) * total);
          frames.push({ transform: transformOf({ ...next, tx: cur.tx + x, ty: cur.ty + y }), offset: k / n });
        }
      } else {
        pts.forEach((p, i) => frames.push({ transform: transformOf({ ...next, tx: cur.tx + p[0], ty: cur.ty + p[1] }), offset: lens[i] / total }));
      }
      frames[0].transform = from;
      frames[frames.length - 1].transform = end;
      track(h.animate(frames, opts('linear')));
    } else if (canAnimate) {
      const mix = (u: number) => transformOf({
        tx: cur.tx + (next.tx - cur.tx) * u, ty: cur.ty + (next.ty - cur.ty) * u,
        sx: cur.sx + (next.sx - cur.sx) * u, sy: cur.sy + (next.sy - cur.sy) * u, rot: cur.rot + (next.rot - cur.rot) * u,
      });
      const frames = Array.from({ length: steps + 1 }, (_, k) => ({ transform: k === steps ? end : k === 0 ? from : mix(ease(k / steps)), offset: k / steps }));
      track(h.animate(frames, opts('linear')));
    }
  }
  if (to.opacity !== undefined || keyOpacity) {
    const from = h.style.opacity || '1';
    if (!back && to.opacity !== undefined) h.style.opacity = String(to.opacity);
    // 过程中的变化已经在关键帧里
    if (canAnimate && !keyOpacity && to.opacity !== undefined) track(h.animate([{ opacity: from }, { opacity: String(to.opacity) }], opts()));
  }
  const recolor = (sel: string, color: string) => {
    for (const node of Array.from(el.querySelectorAll(sel))) {
      const n = node as SVGElement;
      const f = n.getAttribute('fill');
      if (!f || f === 'none' || f.startsWith('url(')) continue;
      const from = n.style.fill || f;
      if (!back) n.style.fill = color;
      if (canAnimate && typeof n.animate === 'function') track(n.animate([{ fill: from }, { fill: color }], opts()));
    }
  };
  if (to.fill) recolor('path,rect,ellipse,circle,polygon', to.fill);
  if (to.color) recolor('text', to.color);
}
