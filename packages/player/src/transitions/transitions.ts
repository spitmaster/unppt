/** 已注册的页面切换（新切换在这里加一行） */
import type { SlideTransition } from '../../../format/src/index';
import { blinds } from './blinds';
import { checker } from './checker';
import { circle } from './circle';
import { comb } from './comb';
import { cover } from './cover';
import { cut } from './cut';
import { diamond } from './diamond';
import { dissolve } from './dissolve';
import { fade } from './fade';
import { flash } from './flash';
import { morph } from './morph';
import { newsflash } from './newsflash';
import { plus } from './plus';
import { pull } from './pull';
import { push } from './push';
import { randomBar } from './random-bar';
import { split } from './split';
import { strips } from './strips';
import type { TransitionEffect } from './transition';
import { wedge } from './wedge';
import { wheel } from './wheel';
import { wipe } from './wipe';
import { zoom } from './zoom';

const TRANSITIONS: readonly TransitionEffect[] = [
  fade, cut, flash, push, cover, pull, wipe, split, strips, circle, diamond, plus, zoom, wheel, wedge, newsflash,
  blinds, checker, comb, randomBar, dissolve, morph,
];

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
