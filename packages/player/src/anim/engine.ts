/**
 * 动画引擎：播放一组动作（带过渡）、瞬时应用一组动作（跳转时用）、把正在播的动画直接跳到结束。
 * 具体效果的关键帧来自 effects/（AnimEffect 扩展点），强调和路径见 target.ts，逐字见 text-units.ts。
 */
import type { AnimAction } from '../../../format/src/index';
import { mediaCommand, type MediaHost } from '../media';
import { effectKeyframes } from './effects/effects';
import { repeatOptions } from './repeat';
import { applyTarget, type TransformState } from './target';
import { TextUnits, type AnimHost } from './text-units';

/** 引擎看到的当前页面 */
export interface Scene {
  find(uid: string): Element | null;
  readonly width: number;
  readonly height: number;
}

export class AnimationEngine implements AnimHost {
  private running: Animation[] = [];
  private pendingCleanups: (() => void)[] = [];
  /** 每个元素累计的强调/路径状态（换页时清空，跳转时从头重算，保证确定性） */
  private states = new Map<Element, TransformState>();
  private units = new TextUnits();
  private readonly trackFn = (a: Animation) => this.track(a);

  /** media：媒体控制（播放器注入，用来支持跨页播放）；不传时直接控制元素里的音视频 */
  constructor(private scene: Scene, private media: MediaHost = { command: (el, a) => mediaCommand(el, a.media!, a.start) }) {}

  get slideW() { return this.scene.width; }
  get slideH() { return this.scene.height; }

  track(a: Animation) {
    this.running.push(a);
  }

  cleanupLater(fn: () => void) {
    this.pendingCleanups.push(fn);
  }

  /** 换页时调用 */
  resetStates() {
    this.states = new Map();
  }

  /** 新指令到达时，把还在播的动画直接跳到结束状态 */
  finishRunning() {
    for (const fn of this.pendingCleanups) fn();
    this.pendingCleanups = [];
    for (const a of this.running) {
      try { a.finish(); } catch { a.cancel(); }
    }
    this.running = [];
  }

  applyInstant(actions: AnimAction[]) {
    for (const a of actions) {
      const el = this.scene.find(a.uid);
      if (!el) continue;
      // 自动翻转的进入 / 退出播完回到开始前：进入的又看不见了，退出的又出现了
      const visible = a.dir === 'in' ? !a.autoRev : a.dir === 'out' ? !!a.autoRev : undefined;
      if (visible === true) el.classList.remove('unppt-hide');
      else if (visible === false) el.classList.add('unppt-hide');
      if (a.to) applyTarget(el, a.to, false, 0, 0, this.states, this.trackFn, repeatOptions(a));
    }
  }

  play(actions: AnimAction[]) {
    for (const a of actions) {
      const el = this.scene.find(a.uid);
      if (!el) continue;
      if (a.to) { applyTarget(el, a.to, true, a.dur, a.delay, this.states, this.trackFn, repeatOptions(a)); continue; }
      if (a.media) {
        const run = () => this.media.command(el, a);
        if (a.delay) { const t = setTimeout(run, a.delay); this.cleanupLater(() => clearTimeout(t)); } else run();
        continue;
      }
      if (a.dir === 'in') el.classList.remove('unppt-hide');
      if (a.iterate && this.units.play(el, a, this)) continue;
      // 没有时长、或者浏览器太老不支持 Web Animations（老版本 Android WebView）：直接显示结果
      if ((!a.dur && !a.delay) || typeof (el as HTMLElement).animate !== 'function') {
        if (a.dir === 'out') el.classList.add('unppt-hide');
        continue;
      }
      const { frames, easing } = effectKeyframes(a, el, this.scene.width, this.scene.height);
      if (a.dir === 'in' && a.delay) {
        // 延迟期间保持隐藏
        el.classList.add('unppt-hide');
        const t = setTimeout(() => el.classList.remove('unppt-hide'), a.delay);
        this.cleanupLater(() => { clearTimeout(t); el.classList.remove('unppt-hide'); });
      }
      const anim = el.animate(frames, { duration: Math.max(1, a.dur), delay: a.delay, easing, fill: 'backwards', ...repeatOptions(a) });
      // 播完不可见的：退出，以及自动翻转的进入
      if ((a.dir === 'out') !== !!a.autoRev) {
        const hide = () => el.classList.add('unppt-hide');
        anim.addEventListener('finish', hide);
        anim.addEventListener('cancel', hide);
      }
      this.track(anim);
    }
  }
}
