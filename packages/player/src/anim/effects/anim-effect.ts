/**
 * 扩展点：进入 / 退出动画效果的关键帧。
 * 加一种效果：新建一个实现 AnimEffect 的文件，在 effects.ts 里加一行；没注册的效果按淡入淡出播放。
 * 退出动画用同一组关键帧倒着播（reversible() 帮忙处理）。
 */
import type { AnimAction } from '../../../../format/src/index';

export interface EffectKeyframes {
  frames: Keyframe[];
  easing: string;
}

export interface AnimEffect {
  /** 对应 AnimAction.effect */
  readonly name: string;
  keyframes(a: AnimAction, el: Element, slideW: number, slideH: number): EffectKeyframes;
}

/** 进入动画的关键帧；退出时倒过来 */
export const reversible = (a: AnimAction, frames: Keyframe[]) => (a.dir === 'out' ? frames.slice().reverse() : frames);
