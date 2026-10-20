/**
 * 播放器核心：翻页状态（第几页、第几步）、显示页面、事件、超链接和触发器。
 * 动画交给 AnimationEngine，页面切换交给 transitions/，按钮和输入交给 ui/。
 */
import type { AnimAction, DeckSlide, PlayerState } from '../../../format/src/index';
import { AnimationEngine } from '../anim/engine';
import { injectCss } from '../css';
import type { DeckLike } from '../deck';
import { MediaPlayer, mediaCommand } from '../media';
import { MediaBar } from '../ui/media-bar';
import { BlankScreen } from '../ui/blank-screen';
import { runTransition } from '../transitions/transitions';
import { Controls } from '../ui/controls';
import { bindInput, type InputOptions } from '../ui/input';
import { AutoPlay, playTime } from './autoplay';
import { Emitter, type Listener } from './emitter';
import { LiveState, type LiveExtras } from './live';

export interface MountOptions extends InputOptions {
  /** 起始位置 */
  slide?: number;
  step?: number;
  /** 是否显示自带的翻页按钮，默认显示 */
  ui?: boolean;
  /** 点击外部链接时是否自动在新窗口打开，默认是（同时都会发出 link 事件） */
  openLinks?: boolean;
  /** 是否按演示文稿里设置的自动换片时间自动放映，默认是 */
  timings?: boolean;
  /**
   * 静态显示（比对工具对照 PowerPoint 静态导出的参考图用）：每页所有对象原样显示，不放动画、不摆动画的起始状态
   * （动画前隐藏的对象也显示，进入页面自动播放的动画不执行）
   */
  static?: boolean;
  /**
   * present 演绎模式（默认）：观看者自己点击、按键、滑动翻页，有按钮和音视频控制条；
   * watch 观看模式：只由 JS 接口驱动，没有按钮，点击、键盘、触屏、链接、触发器、控制条都不响应，也不按计时自动放映
   */
  mode?: 'present' | 'watch';
}

export class Player {
  readonly root: HTMLElement;
  private stage: HTMLElement;
  private current?: HTMLElement;
  /** 当前页的数据（按需加载时别的页可能还没到，当前页的数据留在手上） */
  private data?: DeckSlide;
  /** 每次翻页加一：页面数据加载回来时只显示最后一次要求的那一页 */
  private navToken = 0;
  private slideIdx = 0;
  private stepIdx = 0;
  private events = new Emitter();
  private controls?: Controls;
  private cleanup: (() => void)[] = [];
  private engine: AnimationEngine;
  /** 音视频（含跨页播放的背景音乐） */
  private media: MediaPlayer;
  private mediaBar: MediaBar;
  private blankScreen: BlankScreen;
  /** 触发器进度、黑屏、音视频状态（直播课同步，见 live.ts） */
  private live: LiveState;
  /** sync 时目标页还在加载：加载完显示后再对齐附加部分 */
  private pendingLive?: { slide: number; extras: LiveExtras };
  /** 按计时自动放映 */
  private auto: AutoPlay;

  constructor(host: HTMLElement, private deck: DeckLike, private opts: MountOptions = {}) {
    injectCss(host.ownerDocument);
    this.root = host.ownerDocument.createElement('div');
    this.root.className = 'unppt-root';
    const watch = opts.mode === 'watch';
    if (watch) this.root.classList.add('unppt-watch');
    this.stage = host.ownerDocument.createElement('div');
    this.stage.className = 'unppt-stage';
    this.stage.style.width = `${deck.width}px`;
    this.stage.style.height = `${deck.height}px`;
    this.root.appendChild(this.stage);
    host.appendChild(this.root);
    const keep = host.ownerDocument.createElement('div');
    keep.style.display = 'none';
    this.root.appendChild(keep);
    this.media = new MediaPlayer(keep, () => this.slideIdx);
    this.engine = new AnimationEngine({ find: (uid) => this.find(uid), width: deck.width, height: deck.height }, this.media);
    this.auto = new AutoPlay({
      slide: () => this.data!,
      stepIndex: () => this.stepIdx,
      stepCount: () => this.steps().length,
      next: () => this.next(),
    }, !watch && opts.timings !== false && deck.show?.useTimings !== false);
    if (opts.ui !== false && !watch) this.controls = new Controls(this.root, () => this.prev(), () => this.next());
    this.mediaBar = new MediaBar(this.root);
    this.blankScreen = new BlankScreen(this.root);
    this.live = new LiveState({
      page: () => this.current,
      data: () => this.data,
      play: (steps, animated) => { this.engine.finishRunning(); if (animated) this.engine.play(steps); else this.engine.applyInstant(steps); },
      changed: () => this.emit('change'),
      blank: this.blankScreen,
    });
    if (!watch) this.cleanup.push(...bindInput(this.root, opts, {
      click: (t) => this.click(t),
      next: () => this.next(),
      prev: () => this.prev(),
      first: () => this.goto(this.visibleFrom(0, 1) ?? 0, 0),
      last: () => this.goto(this.visibleFrom(this.deck.slideCount - 1, -1) ?? this.deck.slideCount - 1, 0),
      blank: (color) => { this.blankScreen.show(color); this.emit('change'); },
      blanked: () => this.blankScreen.active,
      unblank: () => { this.blankScreen.hide(); this.emit('change'); },
      jump: (n) => { if (n >= 1 && n <= this.deck.slideCount) this.goto(n - 1, 0); },
    }));
    this.fit();
    const win = host.ownerDocument.defaultView;
    if (win) {
      const onResize = () => this.fit();
      if ('ResizeObserver' in win) {
        const ro = new ResizeObserver(onResize);
        ro.observe(this.root);
        this.cleanup.push(() => ro.disconnect());
      }
      win.addEventListener('resize', onResize);
      this.cleanup.push(() => win.removeEventListener('resize', onResize));
    }
    // 没指定起始页时从第一张不隐藏的页开始，并且像 PowerPoint 开始放映一样播放这一页的自动动画；
    // 指定了起始页、步骤（深链接、直播课同步）时直接摆成那一步的样子
    const fromStart = opts.slide === undefined && !opts.step;
    this.show(opts.slide === undefined ? this.visibleFrom(0, 1) ?? 0 : this.clampSlide(opts.slide), opts.step ?? 0, fromStart);
  }

  // ---------------- 公开接口

  getState(): PlayerState {
    return { slide: this.slideIdx, step: this.stepIdx, slideCount: this.deck.slideCount, stepCount: this.steps().length, ...this.live.extras() };
  }

  on(event: string, fn: Listener) {
    return this.events.on(event, fn);
  }

  off(event: string, fn: Listener) {
    this.events.off(event, fn);
  }

  next(): PlayerState {
    this.engine.finishRunning();
    const steps = this.steps();
    if (this.stepIdx < steps.length) {
      this.engine.play(steps[this.stepIdx]);
      this.stepIdx++;
      this.auto.played(steps[this.stepIdx - 1]);
      this.emit('change');
    } else {
      // 顺序放映跳过隐藏的页（从隐藏页继续往后也一样）；循环放映时最后一页之后回到第一页
      const next = this.visibleFrom(this.slideIdx + 1, 1) ?? (this.deck.show?.loop ? this.visibleFrom(0, 1) : undefined);
      if (next !== undefined) this.show(next, 0, true);
      else this.emit('end');
    }
    return this.getState();
  }

  prev(): PlayerState {
    this.engine.finishRunning();
    if (this.stepIdx > 0) this.show(this.slideIdx, this.stepIdx - 1, false);
    else {
      const target = this.visibleFrom(this.slideIdx - 1, -1);
      if (target !== undefined) this.show(target, Infinity, false);
    }
    return this.getState();
  }

  /**
   * 同步（观看端跟上演绎端）：目标正好是下一步、或者当前页已经播完而目标是下一页的开头时，照常播动画和切换；
   * 和现在一样时什么都不做；其它情况直接跳到目标的最终状态（中途进入、掉线重连、丢了消息）
   */
  sync(target: Partial<PlayerState>): PlayerState {
    const s = this.clampSlide(target.slide ?? 0), step = target.step ?? 0;
    const extras: LiveExtras = { blank: target.blank, triggers: target.triggers, media: target.media };
    if (s !== this.slideIdx || step !== this.stepIdx) {
      const steps = this.steps().length;
      const nextSlide = this.visibleFrom(this.slideIdx + 1, 1) ?? (this.deck.show?.loop ? this.visibleFrom(0, 1) : undefined);
      const oneStep = s === this.slideIdx && step === this.stepIdx + 1 && step <= steps;
      const nextPage = s === nextSlide && step === 0 && this.stepIdx >= steps;
      if (oneStep || nextPage) this.next(); else this.goto(s, step);
    }
    // 目标页已经显示出来就对齐附加部分，还在加载就等显示以后
    if (this.slideIdx === s && this.data) this.live.apply(extras);
    else this.pendingLive = { slide: s, extras };
    return this.getState();
  }

  /** 确定性跳转：直接到目标页、目标步骤的最终状态 */
  goto(slide: number, step = 0): PlayerState {
    this.engine.finishRunning();
    this.show(this.clampSlide(slide), step, false);
    return this.getState();
  }

  destroy() {
    this.mediaBar.destroy();
    this.blankScreen.destroy();
    this.auto.stop();
    this.engine.finishRunning();
    this.media.stopAll();
    for (const c of this.cleanup) c();
    this.root.remove();
  }

  // ---------------- 内部

  /** 点击画面：触发器 > 超链接 > 下一步 */
  private click(t: Element) {
    if (this.live.fire(t, this.root)) return;
    const link = t.closest('[data-link],[data-href]');
    if (link) { this.follow(link); return; }
    // 设置了"单击鼠标时不换片"的页：单击画面不往下走（键盘和接口照常）
    if (this.data?.advance?.click === false) return;
    this.next();
  }

  /** 跟随超链接：站内跳转直接翻页；外部网址发 link 事件，并（默认）在新窗口打开 */
  private follow(el: Element) {
    const href = el.getAttribute('data-href');
    if (href) {
      // 只认网址、邮件、电话（产物可能被改过，转码时已经过滤一遍）；总是在新标签页打开，不让课件里的链接把播放器所在的页面跳走
      if (!/^(https?:|mailto:|tel:)/i.test(href)) return;
      this.emit('link', href);
      if (this.opts.openLinks !== false) this.root.ownerDocument.defaultView?.open(href, '_blank', 'noopener,noreferrer');
      return;
    }
    const link = el.getAttribute('data-link') ?? '';
    if (link === 'media') { mediaCommand(el, 'toggle'); return; }
    if (link === 'next') this.goto(this.visibleFrom(this.slideIdx + 1, 1) ?? this.slideIdx, 0);
    else if (link === 'prev') this.goto(this.visibleFrom(this.slideIdx - 1, -1) ?? this.slideIdx, 0);
    else if (link === 'first') this.goto(this.visibleFrom(0, 1) ?? 0, 0);
    else if (link === 'last') this.goto(this.visibleFrom(this.deck.slideCount - 1, -1) ?? this.deck.slideCount - 1, 0);
    else if (link.startsWith('slide:')) {
      const i = (this.deck.slideParts ?? []).indexOf(link.slice(6));
      if (i >= 0) this.goto(i, 0);
    }
  }

  /** 从 i 开始按 dir 方向找第一张不隐藏的页 */
  private visibleFrom(i: number, dir: 1 | -1): number | undefined {
    for (let k = i; k >= 0 && k < this.deck.slideCount; k += dir) if (!this.deck.skip(k)) return k;
    return undefined;
  }

  private steps(): AnimAction[][] {
    return this.data?.steps ?? [];
  }

  private clampSlide(i: number) {
    return Math.max(0, Math.min(this.deck.slideCount - 1, Math.floor(Number(i) || 0)));
  }

  private emit(event: 'ready' | 'change' | 'end' | 'link', url?: string) {
    const s: PlayerState & { url?: string } = url ? { ...this.getState(), url } : this.getState();
    this.controls?.update(this.slideIdx, this.deck.slideCount);
    this.events.emit(event, s);
  }

  private fit() {
    const r = this.root.getBoundingClientRect();
    const w = r.width || this.deck.width, h = r.height || this.deck.height;
    const scale = Math.min(w / this.deck.width, h / this.deck.height);
    const x = (w - this.deck.width * scale) / 2, y = (h - this.deck.height * scale) / 2;
    this.stage.style.transform = `translate(${x}px,${y}px) scale(${scale})`;
  }

  private show(slideIdx: number, step: number, animated: boolean) {
    const token = ++this.navToken;
    if (!this.deck.ready(slideIdx)) {
      // 按需加载：这页的数据还没到，先加载（超过 0.2 秒显示"加载中"），到了再显示
      const timer = setTimeout(() => this.root.classList.add('unppt-loading'), 200);
      const done = () => { clearTimeout(timer); this.root.classList.remove('unppt-loading'); };
      this.deck.load(slideIdx).then(() => {
        done();
        if (token === this.navToken) this.show(slideIdx, step, animated);
      }, (e: Error) => {
        done();
        if (token === this.navToken) this.loadFailed(slideIdx, e);
      });
      return;
    }
    const data = this.deck.slide(slideIdx);
    this.data = data;
    const doc = this.root.ownerDocument;
    const el = doc.createElement('div');
    el.className = 'unppt-slide';
    el.innerHTML = data.svg;
    this.engine.resetStates();
    const old = this.current;
    if (old) for (const m of Array.from(old.querySelectorAll('video,audio'))) (m as HTMLMediaElement).pause();
    this.stage.appendChild(el);
    this.live.enter(el);
    this.mediaBar.attach(el);
    this.current = el;
    this.slideIdx = slideIdx;
    this.media.enter(slideIdx);
    this.stepIdx = Math.max(0, Math.min(data.steps.length, Math.floor(Number(step) || 0)));
    // 初始状态（静态显示时不摆，见 MountOptions.static）
    const still = this.opts.static === true;
    if (!still) for (const uid of data.hidden) this.find(uid)?.classList.add('unppt-hide');
    for (const uid of data.fullScreen ?? []) this.find(uid)?.querySelector('video')?.setAttribute('data-full-screen', '1');
    for (const tr of data.triggers ?? []) this.find(tr.uid)?.classList.add('unppt-trigger');
    if (!still) {
      if (animated) this.engine.play(data.auto);
      else this.engine.applyInstant(data.auto);
      for (let i = 0; i < this.stepIdx; i++) this.engine.applyInstant(data.steps[i]);
    }
    // 切换声音：翻页播放时才有（跳转、深链接不出声）
    if (animated && data.transition?.stopSound) this.media.stopSound();
    if (animated && data.transition?.sound) this.media.sound(data.transition.sound);
    if (old) {
      if (animated && data.transition && data.transition.type !== 'none') {
        const a = runTransition(old, el, data.transition);
        if (a) this.engine.track(a);
      } else old.remove();
    }
    this.auto.entered(animated ? Math.max(playTime(data.auto), data.transition?.dur ?? 0) : 0);
    const pl = this.pendingLive;
    this.pendingLive = undefined;
    if (pl && pl.slide === slideIdx) this.live.apply(pl.extras);
    this.emit('change');
    // 预加载下一页（按需加载的形式；内联的形式什么都不做）
    const next = this.visibleFrom(slideIdx + 1, 1);
    if (next !== undefined) this.deck.load(next).catch(() => {});
  }

  private loadFailed(slideIdx: number, e: Error) {
    const el = this.root.ownerDocument.createElement('div');
    el.className = 'unppt-error';
    el.textContent = `第 ${slideIdx + 1} 页加载失败：${e.message}`;
    this.stage.appendChild(el);
  }

  private find(uid: string): Element | null {
    return this.current?.querySelector(`[data-uid="${uid}"]`) ?? null;
  }
}
