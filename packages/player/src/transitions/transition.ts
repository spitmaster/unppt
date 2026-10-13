/**
 * 扩展点：页面切换效果。加一种：新建一个实现 TransitionEffect 的文件，在 transitions.ts 里加一行；
 * 没注册的切换按淡入播放。
 * run 返回"切换结束"的那个动画：它结束（或被取消）时旧页面会被移除。
 */
import type { SlideTransition } from '../../../format/src/index';

export interface TransitionEffect {
  readonly type: SlideTransition['type'];
  /** old 是旧页面，el 是新页面（已经在旧页面上方）；dur 已限制在合理范围 */
  run(old: HTMLElement, el: HTMLElement, t: SlideTransition, dur: number): Animation;
}

const NONE = 'translate(0,0)';

/** 方向 l 表示向左运动：新页从右边进来（off），旧页往左出去（away） */
export function motion(t: SlideTransition): { off: string; away: string; none: string } {
  const dir = t.dir ?? 'l';
  const off = dir === 'l' ? 'translateX(100%)' : dir === 'r' ? 'translateX(-100%)' : dir === 'u' ? 'translateY(100%)' : 'translateY(-100%)';
  const away = dir === 'l' ? 'translateX(-100%)' : dir === 'r' ? 'translateX(100%)' : dir === 'u' ? 'translateY(-100%)' : 'translateY(100%)';
  return { off, away, none: NONE };
}
