/** 动画的重复和自动翻转 -> Web Animations 的播放参数 */
import type { AnimAction } from '../../../format/src/index';

export interface RepeatOptions { iterations: number; direction: PlaybackDirection }

export const ONCE: RepeatOptions = { iterations: 1, direction: 'normal' };

/** 重复 n 次（-1 是一直重复到下一次点击）；自动翻转时每次是"正着播 + 倒着播"两段 */
export function repeatOptions(a: AnimAction): RepeatOptions {
  if (!a.repeat && !a.autoRev) return ONCE;
  const n = a.repeat === -1 ? Infinity : Math.max(1, a.repeat ?? 1);
  return { iterations: a.autoRev ? n * 2 : n, direction: a.autoRev ? 'alternate' : 'normal' };
}
