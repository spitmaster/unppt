/** 已注册的进入 / 退出动画效果（新效果在这里加一行） */
import type { AnimAction } from '../../../../format/src/index';
import { behaviorKeyframes } from '../behaviors';
import type { AnimEffect, EffectKeyframes } from './anim-effect';
import { blinds } from './blinds';
import { emphasis } from './emphasis';
import { fade } from './fade';
import { float } from './float';
import { fly } from './fly';
import { bounce, growTurn, swivel } from './motion-effects';
import { path } from './path';
import { shape } from './shape';
import { split } from './split';
import { wheel } from './wheel';
import { wipe } from './wipe';
import { zoom } from './zoom';

const EFFECTS: readonly AnimEffect[] = [fade, fly, wipe, split, zoom, float, shape, wheel, blinds, growTurn, swivel, bounce, emphasis, path];

/** 按名字找效果；没注册的按淡入淡出 */
export function animEffect(name: string): AnimEffect {
  return EFFECTS.find((e) => e.name === name) ?? fade;
}

/** 一个动作的关键帧：带 PowerPoint 行为的按行为播放，否则按效果名 */
export function effectKeyframes(a: AnimAction, el: Element, slideW: number, slideH: number): EffectKeyframes {
  return a.behaviors?.length ? behaviorKeyframes(a, el, slideW, slideH) : animEffect(a.effect).keyframes(a, el, slideW, slideH);
}
