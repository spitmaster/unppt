/**
 * 扩展点：页面切换效果。加一种：新建一个实现 TransitionEffect 的文件，在 transitions.ts 里加一行；
 * 没注册的切换按淡入播放。
 * run 返回"切换结束"的那个动画：它结束（或被取消）时旧页面会被移除。
 * 各效果的几何和速度曲线按 PowerPoint 放映实测（见 SPEC 第 7 节）。
 */
import type { SlideTransition } from '../../../format/src/index';

export interface TransitionEffect {
  readonly type: SlideTransition['type'];
  /** old 是旧页面，el 是新页面（已经在旧页面上方）；dur 已限制在合理范围 */
  run(old: HTMLElement, el: HTMLElement, t: SlideTransition, dur: number): Animation;
}

/** 实测的速度曲线 */
export const EASE = {
  /** 淡入：0.5 - 0.5cos(πt) */
  cosine: 'cubic-bezier(0.37, 0, 0.63, 1)',
  /** 覆盖、揭开（上下左右） */
  slide: 'cubic-bezier(0.7, 0, 0.3, 1)',
};

const NONE = 'translate(0,0)';
const STEP: Record<NonNullable<SlideTransition['dir']>, [number, number]> = {
  l: [-1, 0], r: [1, 0], u: [0, -1], d: [0, 1], lu: [-1, -1], ru: [1, -1], ld: [-1, 1], rd: [1, 1],
};

/** 方向 l 表示向左运动：新页从右边进来（off），旧页往左出去（away）；斜向同理 */
export function motion(t: SlideTransition): { off: string; away: string; none: string; diagonal: boolean } {
  const [x, y] = STEP[t.dir ?? 'l'] ?? STEP.l;
  return { off: `translate(${-x * 100}%,${-y * 100}%)`, away: `translate(${x * 100}%,${y * 100}%)`, none: NONE, diagonal: x !== 0 && y !== 0 };
}
