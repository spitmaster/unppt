/** 已注册的进入 / 退出动画效果（新效果在这里加一行） */
import type { AnimEffect } from './anim-effect';
import { emphasis } from './emphasis';
import { fade } from './fade';
import { float } from './float';
import { fly } from './fly';
import { path } from './path';
import { split } from './split';
import { wipe } from './wipe';
import { zoom } from './zoom';

const EFFECTS: readonly AnimEffect[] = [fade, fly, wipe, split, zoom, float, emphasis, path];

/** 按名字找效果；没注册的按淡入淡出 */
export function animEffect(name: string): AnimEffect {
  return EFFECTS.find((e) => e.name === name) ?? fade;
}
