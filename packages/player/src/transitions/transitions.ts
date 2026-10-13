/** 已注册的页面切换（新切换在这里加一行） */
import type { SlideTransition } from '../../../format/src/index';
import { circle } from './circle';
import { cover } from './cover';
import { fade } from './fade';
import { pull } from './pull';
import { push } from './push';
import { split } from './split';
import type { TransitionEffect } from './transition';
import { wipe } from './wipe';

const TRANSITIONS: readonly TransitionEffect[] = [fade, push, cover, pull, wipe, split, circle];

/**
 * 播放切换，结束后移除旧页面。返回切换动画（交给调用方统一管理，翻页时可以直接跳到结束）；
 * 浏览器不支持 Web Animations 时直接移除旧页面，返回 undefined。
 */
export function runTransition(old: HTMLElement, el: HTMLElement, t: SlideTransition): Animation | undefined {
  if (typeof el.animate !== 'function') { old.remove(); return undefined; }
  const dur = Math.max(100, Math.min(3000, t.dur));
  const effect = TRANSITIONS.find((x) => x.type === t.type) ?? fade;
  const a = effect.run(old, el, t, dur);
  const done = () => old.remove();
  a.addEventListener('finish', done);
  a.addEventListener('cancel', done);
  return a;
}
