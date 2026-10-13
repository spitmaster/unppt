/**
 * 播放器核心：翻页状态（第几页、第几步）、显示页面、事件、超链接和触发器。
 * 动画交给 AnimationEngine，页面切换交给 transitions/，按钮和输入交给 ui/。
 */
import type { AnimAction, PlayerState } from '../../../format/src/index';
import { AnimationEngine } from '../anim/engine';
import { injectCss } from '../css';
import type { DeckLike } from '../deck';
import { mediaCommand } from '../media';
import { runTransition } from '../transitions/transitions';
import { Controls } from '../ui/controls';
import { bindInput, type InputOptions } from '../ui/input';
import { Emitter, type Listener } from './emitter';

export interface MountOptions extends InputOptions {
  /** 起始位置 */
  slide?: number;
  step?: number;
  /** 是否显示自带的翻页按钮，默认显示 */
  ui?: boolean;
  /** 点击外部链接时是否自动在新窗口打开，默认是（同时都会发出 link 事件） */
  openLinks?: boolean;
}

export class Player {
  readonly root: HTMLElement;
  private stage: HTMLElement;
  private current?: HTMLElement;
  private slideIdx = 0;
  private stepIdx = 0;
  private events = new Emitter();
  private controls?: Controls;
  private cleanup: (() => void)[] = [];
  private engine: AnimationEngine;
  /** 每个触发器已经播到第几组（换页时清零） */
  private triggerIdx = new Map<string, number>();

  constructor(host: HTMLElement, private deck: DeckLike, private opts: MountOptions = {}) {
    injectCss(host.ownerDocument);
    this.root = host.ownerDocument.createElement('div');
    this.root.className = 'unppt-root';
    this.stage = host.ownerDocument.createElement('div');
    this.stage.className = 'unppt-stage';
    this.stage.style.width = `${deck.width}px`;
    this.stage.style.height = `${deck.height}px`;
    this.root.appendChild(this.stage);
    host.appendChild(this.root);
    this.engine = new AnimationEngine({ find: (uid) => this.find(uid), width: deck.width, height: deck.height });
    if (opts.ui !== false) this.controls = new Controls(this.root, () => this.prev(), () => this.next());
    this.cleanup.push(...bindInput(this.root, opts, {
      click: (t) => this.click(t),
      next: () => this.next(),
      prev: () => this.prev(),
      first: () => this.goto(this.visibleFrom(0, 1) ?? 0, 0),
      last: () => this.goto(this.visibleFrom(this.deck.slideCount - 1, -1) ?? this.deck.slideCount - 1, 0),
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
    // 没指定起始页时从第一张不隐藏的页开始
    this.show(opts.slide === undefined ? this.visibleFrom(0, 1) ?? 0 : this.clampSlide(opts.slide), opts.step ?? 0, false);
  }

  // ---------------- 公开接口

  getState(): PlayerState {
    return { slide: this.slideIdx, step: this.stepIdx, slideCount: this.deck.slideCount, stepCount: this.steps().length };
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
      this.emit('change');
    } else {
      // 顺序放映跳过隐藏的页（从隐藏页继续往后也一样）
      const next = this.visibleFrom(this.slideIdx + 1, 1);
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
      if (target !== undefined) this.show(target, this.deck.slide(target).steps.length, false);
    }
    return this.getState();
  }

  /** 确定性跳转：直接到目标页、目标步骤的最终状态 */
  goto(slide: number, step = 0): PlayerState {
    this.engine.finishRunning();
    this.show(this.clampSlide(slide), step, false);
    return this.getState();
  }

  destroy() {
    this.engine.finishRunning();
    for (const c of this.cleanup) c();
    this.root.remove();
  }

  // ---------------- 内部

  /** 点击画面：触发器 > 超链接 > 下一步 */
  private click(t: Element) {
    if (this.fireTrigger(t)) return;
    const link = t.closest('[data-link],[data-href]');
    if (link) { this.follow(link); return; }
    this.next();
  }

  /** 跟随超链接：站内跳转直接翻页；外部网址发 link 事件，并（默认）在新窗口打开 */
  private follow(el: Element) {
    const href = el.getAttribute('data-href');
    if (href) {
      this.emit('link', href);
      if (this.opts.openLinks !== false) this.root.ownerDocument.defaultView?.open(href, '_blank', 'noopener');
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

  /** 点击的是触发器形状：播放它的下一组动作 */
  private fireTrigger(target: Element): boolean {
    const triggers = this.deck.slide(this.slideIdx).triggers;
    if (!triggers || !triggers.length) return false;
    for (let el: Element | null = target; el && el !== this.root; el = el.parentElement) {
      const uid = el.getAttribute('data-uid');
      const tr = uid ? triggers.find((x) => x.uid === uid) : undefined;
      if (!tr) continue;
      const i = this.triggerIdx.get(tr.uid) ?? 0;
      if (i >= tr.steps.length) return true;
      this.engine.finishRunning();
      this.engine.play(tr.steps[i]);
      this.triggerIdx.set(tr.uid, i + 1);
      return true;
    }
    return false;
  }

  /** 从 i 开始按 dir 方向找第一张不隐藏的页 */
  private visibleFrom(i: number, dir: 1 | -1): number | undefined {
    for (let k = i; k >= 0 && k < this.deck.slideCount; k += dir) if (!this.deck.slide(k).skip) return k;
    return undefined;
  }

  private steps(): AnimAction[][] {
    return this.deck.slide(this.slideIdx).steps;
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
    const data = this.deck.slide(slideIdx);
    const doc = this.root.ownerDocument;
    const el = doc.createElement('div');
    el.className = 'unppt-slide';
    el.innerHTML = data.svg;
    this.engine.resetStates();
    this.triggerIdx = new Map();
    const old = this.current;
    if (old) for (const m of Array.from(old.querySelectorAll('video,audio'))) (m as HTMLMediaElement).pause();
    this.stage.appendChild(el);
    this.current = el;
    this.slideIdx = slideIdx;
    this.stepIdx = Math.max(0, Math.min(data.steps.length, Math.floor(Number(step) || 0)));
    // 初始状态
    for (const uid of data.hidden) this.find(uid)?.classList.add('unppt-hide');
    for (const tr of data.triggers ?? []) this.find(tr.uid)?.classList.add('unppt-trigger');
    if (animated) this.engine.play(data.auto);
    else this.engine.applyInstant(data.auto);
    for (let i = 0; i < this.stepIdx; i++) this.engine.applyInstant(data.steps[i]);
    if (old) {
      if (animated && data.transition && data.transition.type !== 'none') {
        const a = runTransition(old, el, data.transition);
        if (a) this.engine.track(a);
      } else old.remove();
    }
    this.emit('change');
  }

  private find(uid: string): Element | null {
    return this.current?.querySelector(`[data-uid="${uid}"]`) ?? null;
  }
}
