/**
 * unppt 播放器：零依赖，单文件。
 *
 * 两种用法：
 * 1. 转码出来的 HTML 里自动启动（读取页面里的 #unppt-meta 和 .unppt-slide）；
 * 2. 单独部署：UnpptPlayer.mount(元素, deck对象, 选项)，deck 对象由宿主自己加载。
 *
 * 外部控制（JS bridge）见 SPEC F2：同页 JS（window.unppt）、iframe postMessage、原生 App WebView。
 */
import type { AnimAction, AnimTarget, BridgeCommand, BridgeEvent, BridgeReply, DeckSlide, PlayerState, SlideTransition } from '../../format/src/index';
import { DECK_FORMAT, DECK_FORMAT_VERSION } from '../../format/src/index';

interface DeckLike {
  slideParts?: string[];
  format: string;
  version: number;
  width: number;
  height: number;
  title?: string;
  slideCount: number;
  slide(i: number): DeckSlide;
}

export interface MountOptions {
  /** 起始位置 */
  slide?: number;
  step?: number;
  /** 是否显示自带的翻页按钮，默认显示 */
  ui?: boolean;
  /** 点击画面是否翻到下一步，默认是 */
  clickToNext?: boolean;
  /** 键盘翻页，默认开启 */
  keyboard?: boolean;
  /** 点击外部链接时是否自动在新窗口打开，默认是（同时都会发出 link 事件） */
  openLinks?: boolean;
}

type Listener = (s: PlayerState) => void;

const CSS = `
.unppt-root{position:relative;width:100%;height:100%;overflow:hidden;background:#000;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;touch-action:pan-y pinch-zoom}
.unppt-stage{position:absolute;left:0;top:0;transform-origin:0 0;overflow:hidden;background:#fff}
.unppt-slide{position:absolute;left:0;top:0;width:100%;height:100%}
.unppt-slide>svg{display:block;width:100%;height:100%}
.unppt-slide [data-uid]{transform-box:fill-box;transform-origin:center}
.unppt-hide{visibility:hidden}
.unppt-trigger{cursor:pointer}
.unppt-ui{position:absolute;right:12px;bottom:12px;display:flex;gap:6px;align-items:center;opacity:0;transition:opacity .3s;font:13px/1 system-ui,sans-serif;z-index:2}
.unppt-root:hover .unppt-ui,.unppt-ui.unppt-show{opacity:1}
.unppt-ui button{border:0;border-radius:4px;background:rgba(0,0,0,.55);color:#fff;width:34px;height:30px;font-size:16px;cursor:pointer}
.unppt-ui span{background:rgba(0,0,0,.55);color:#fff;border-radius:4px;padding:8px 10px}
.unppt-error{color:#fff;font:15px system-ui,sans-serif;padding:24px}
`;

function injectCss(doc: Document) {
  if (doc.getElementById('unppt-css')) return;
  const s = doc.createElement('style');
  s.id = 'unppt-css';
  s.textContent = CSS;
  doc.head.appendChild(s);
}

// ---------------------------------------------------------------- 动画关键帧

function keyframes(a: AnimAction, el: Element, slideW: number, slideH: number): { frames: Keyframe[]; easing: string } {
  const inF = (frames: Keyframe[]) => (a.dir === 'out' ? frames.slice().reverse() : frames);
  switch (a.effect) {
    case 'fly': {
      let bb = { x: 0, y: 0, width: 0, height: 0 };
      try { bb = (el as SVGGraphicsElement).getBBox(); } catch { /* 未渲染时取不到 */ }
      const from = a.from ?? 'b';
      const off = from === 'b' ? `translate(0px,${slideH - bb.y}px)` : from === 't' ? `translate(0px,${-(bb.y + bb.height)}px)`
        : from === 'l' ? `translate(${-(bb.x + bb.width)}px,0px)` : `translate(${slideW - bb.x}px,0px)`;
      return { frames: inF([{ transform: off }, { transform: 'translate(0px,0px)' }]), easing: a.dir === 'out' ? 'ease-in' : 'ease-out' };
    }
    case 'wipe': {
      const from = a.from ?? 'l';
      const start = from === 'l' ? 'inset(0 100% 0 0)' : from === 'r' ? 'inset(0 0 0 100%)' : from === 't' ? 'inset(0 0 100% 0)' : 'inset(100% 0 0 0)';
      return { frames: inF([{ clipPath: start }, { clipPath: 'inset(0 0 0 0)' }]), easing: 'linear' };
    }
    case 'split':
      return { frames: inF([{ clipPath: 'inset(0 50% 0 50%)' }, { clipPath: 'inset(0 0 0 0)' }]), easing: 'ease-out' };
    case 'zoom':
      return { frames: inF([{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }]), easing: 'ease-out' };
    case 'float':
      return { frames: inF([{ transform: 'translate(0px,40px)', opacity: 0 }, { transform: 'translate(0px,0px)', opacity: 1 }]), easing: 'ease-out' };
    case 'emphasis':
      return { frames: [{ transform: 'scale(1)' }, { transform: 'scale(1.1)' }, { transform: 'scale(1)' }], easing: 'ease-in-out' };
    case 'path':
      return { frames: [{ opacity: 1 }, { opacity: 1 }], easing: 'linear' };
    default:
      return { frames: inF([{ opacity: 0 }, { opacity: 1 }]), easing: 'linear' };
  }
}

// ---------------------------------------------------------------- 播放器

export class Player {
  readonly root: HTMLElement;
  private stage: HTMLElement;
  private current?: HTMLElement;
  private slideIdx = 0;
  private stepIdx = 0;
  private running: Animation[] = [];
  private listeners = new Map<string, Set<Listener>>();
  private counter?: HTMLElement;
  private cleanup: (() => void)[] = [];

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
    if (opts.ui !== false) this.buildUi();
    this.bindInput();
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
    this.show(this.clampSlide(opts.slide ?? 0), opts.step ?? 0, false);
  }

  // ---------------- 公开接口

  getState(): PlayerState {
    return { slide: this.slideIdx, step: this.stepIdx, slideCount: this.deck.slideCount, stepCount: this.steps().length };
  }

  on(event: string, fn: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    return () => this.off(event, fn);
  }

  off(event: string, fn: Listener) {
    this.listeners.get(event)?.delete(fn);
  }

  next(): PlayerState {
    this.finishRunning();
    const steps = this.steps();
    if (this.stepIdx < steps.length) {
      this.play(steps[this.stepIdx]);
      this.stepIdx++;
      this.emit('change');
    } else if (this.slideIdx < this.deck.slideCount - 1) {
      this.show(this.slideIdx + 1, 0, true);
    } else {
      this.emit('end');
    }
    return this.getState();
  }

  prev(): PlayerState {
    this.finishRunning();
    if (this.stepIdx > 0) this.show(this.slideIdx, this.stepIdx - 1, false);
    else if (this.slideIdx > 0) {
      const target = this.slideIdx - 1;
      this.show(target, this.deck.slide(target).steps.length, false);
    }
    return this.getState();
  }

  /** 确定性跳转：直接到目标页、目标步骤的最终状态 */
  goto(slide: number, step = 0): PlayerState {
    this.finishRunning();
    this.show(this.clampSlide(slide), step, false);
    return this.getState();
  }

  destroy() {
    this.finishRunning();
    for (const c of this.cleanup) c();
    this.root.remove();
  }

  // ---------------- 内部

  /** 跟随超链接：站内跳转直接翻页；外部网址发 link 事件，并（默认）在新窗口打开 */
  private follow(el: Element) {
    const href = el.getAttribute('data-href');
    if (href) {
      this.emit('link', href);
      if (this.opts.openLinks !== false) this.root.ownerDocument.defaultView?.open(href, '_blank', 'noopener');
      return;
    }
    const link = el.getAttribute('data-link') ?? '';
    if (link === 'media') { this.mediaCommand(el, 'toggle'); return; }
    if (link === 'next') this.goto(Math.min(this.slideIdx + 1, this.deck.slideCount - 1), 0);
    else if (link === 'prev') this.goto(Math.max(this.slideIdx - 1, 0), 0);
    else if (link === 'first') this.goto(0, 0);
    else if (link === 'last') this.goto(this.deck.slideCount - 1, 0);
    else if (link.startsWith('slide:')) {
      const i = (this.deck.slideParts ?? []).indexOf(link.slice(6));
      if (i >= 0) this.goto(i, 0);
    }
  }

  /** 每个触发器已经播到第几组（换页时清零） */
  private triggerIdx = new Map<string, number>();

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
      this.finishRunning();
      this.play(tr.steps[i]);
      this.triggerIdx.set(tr.uid, i + 1);
      return true;
    }
    return false;
  }

  /** 对元素里的音频/视频执行命令 */
  private mediaCommand(el: Element, cmd: NonNullable<AnimAction['media']>, start?: number) {
    const m = el.querySelector('audio,video') as HTMLMediaElement | null;
    if (!m) return;
    try {
      if (cmd === 'play') { if (start !== undefined) m.currentTime = start; void m.play().catch(() => {}); }
      else if (cmd === 'pause') m.pause();
      else if (cmd === 'stop') { m.pause(); m.currentTime = 0; }
      else if (m.paused) void m.play().catch(() => {}); else m.pause();
    } catch { /* 浏览器可能阻止自动播放 */ }
  }

  private steps(): AnimAction[][] {
    return this.deck.slide(this.slideIdx).steps;
  }

  private clampSlide(i: number) {
    return Math.max(0, Math.min(this.deck.slideCount - 1, Math.floor(Number(i) || 0)));
  }

  private emit(event: 'ready' | 'change' | 'end' | 'link', url?: string) {
    const s: PlayerState & { url?: string } = url ? { ...this.getState(), url } : this.getState();
    this.updateUi();
    for (const fn of this.listeners.get(event) ?? []) {
      try { fn(s); } catch (e) { console.error(e); }
    }
    for (const fn of this.listeners.get('*') ?? []) {
      try { (fn as unknown as (e: string, s: PlayerState) => void)(event, s); } catch (e) { console.error(e); }
    }
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
    this.states = new Map();
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
    if (animated) {
      this.play(data.auto);
    } else {
      this.applyInstant(data.auto);
    }
    for (let i = 0; i < this.stepIdx; i++) this.applyInstant(data.steps[i]);
    if (old) {
      if (animated && data.transition && data.transition.type !== 'none') this.transition(old, el, data.transition);
      else old.remove();
    }
    this.emit('change');
  }

  private transition(old: HTMLElement, el: HTMLElement, t: SlideTransition) {
    if (typeof el.animate !== 'function') { old.remove(); return; }
    const dur = Math.max(100, Math.min(3000, t.dur));
    let a: Animation;
    switch (t.type) {
      case 'push':
        old.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-100%)' }], { duration: dur, easing: 'ease-in-out' });
        a = el.animate([{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }], { duration: dur, easing: 'ease-in-out' });
        break;
      case 'wipe':
        a = el.animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: dur });
        break;
      case 'cover':
        a = el.animate([{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }], { duration: dur, easing: 'ease-out' });
        break;
      default:
        a = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dur });
    }
    this.running.push(a);
    const done = () => old.remove();
    a.addEventListener('finish', done);
    a.addEventListener('cancel', done);
  }

  private find(uid: string): Element | null {
    return this.current?.querySelector(`[data-uid="${uid}"]`) ?? null;
  }

  private applyInstant(actions: AnimAction[]) {
    for (const a of actions) {
      const el = this.find(a.uid);
      if (!el) continue;
      if (a.dir === 'in') el.classList.remove('unppt-hide');
      else if (a.dir === 'out') el.classList.add('unppt-hide');
      if (a.to) this.applyTarget(el, a.to, false, 0, 0);
    }
  }

  private play(actions: AnimAction[]) {
    for (const a of actions) {
      const el = this.find(a.uid);
      if (!el) continue;
      if (a.to) { this.applyTarget(el, a.to, true, a.dur, a.delay); continue; }
      if (a.media) {
        const run = () => this.mediaCommand(el, a.media!, a.start);
        if (a.delay) { const t = setTimeout(run, a.delay); this.cleanupLater(() => clearTimeout(t)); } else run();
        continue;
      }
      if (a.dir === 'in') el.classList.remove('unppt-hide');
      if (a.iterate && this.playUnits(el, a)) continue;
      // 没有时长、或者浏览器太老不支持 Web Animations（老版本 Android WebView）：直接显示结果
      if ((!a.dur && !a.delay) || typeof (el as HTMLElement).animate !== 'function') {
        if (a.dir === 'out') el.classList.add('unppt-hide');
        continue;
      }
      const { frames, easing } = keyframes(a, el, this.deck.width, this.deck.height);
      if (a.dir === 'in' && a.delay) {
        // 延迟期间保持隐藏
        el.classList.add('unppt-hide');
        const t = setTimeout(() => el.classList.remove('unppt-hide'), a.delay);
        this.cleanupLater(() => { clearTimeout(t); el.classList.remove('unppt-hide'); });
      }
      const anim = el.animate(frames, { duration: Math.max(1, a.dur), delay: a.delay, easing, fill: 'backwards' });
      if (a.dir === 'out') {
        const hide = () => el.classList.add('unppt-hide');
        anim.addEventListener('finish', hide);
        anim.addEventListener('cancel', hide);
      }
      this.running.push(anim);
    }
  }

  /**
   * 文字逐字/逐词：把元素里的文字拆成一个个 tspan，按间隔依次淡入（退出时依次淡出）。
   * tspan 不支持位移，所以飞入等效果也统一按淡入处理；元素本身的填充和边框随第一个字出现。
   * 没有文字或浏览器不支持 Web Animations 时返回 false，按整个元素播放。
   */
  private playUnits(el: Element, a: AnimAction): boolean {
    const units = this.textUnits(el, a.iterate!.by);
    if (!units.length || typeof (el as HTMLElement).animate !== 'function') return false;
    if (a.dir === 'in' && a.delay) {
      el.classList.add('unppt-hide');
      const t = setTimeout(() => el.classList.remove('unppt-hide'), a.delay);
      this.cleanupLater(() => { clearTimeout(t); el.classList.remove('unppt-hide'); });
    }
    const show = a.dir === 'in';
    const anims: Animation[] = [];
    units.forEach((u, i) => {
      const o0 = show ? 0 : 1, o1 = show ? 1 : 0;
      const frames = a.effect === 'appear' || !a.dur
        ? [{ fillOpacity: o0, strokeOpacity: o0 }, { fillOpacity: o0, strokeOpacity: o0, offset: 0.999 }, { fillOpacity: o1, strokeOpacity: o1 }]
        : [{ fillOpacity: o0, strokeOpacity: o0 }, { fillOpacity: o1, strokeOpacity: o1 }];
      const anim = u.animate(frames, { duration: Math.max(1, a.dur), delay: a.delay + i * a.iterate!.gap, fill: show ? 'backwards' : 'forwards' });
      anims.push(anim);
      this.running.push(anim);
    });
    if (!show) {
      // 最后一个字消失后隐藏整个元素，并撤掉"保持透明"的动画，以免以后再次进入时还是透明的
      const done = () => { el.classList.add('unppt-hide'); for (const x of anims) x.cancel(); };
      const last = anims[anims.length - 1];
      last.addEventListener('finish', done);
      last.addEventListener('cancel', () => el.classList.add('unppt-hide'));
    }
    return true;
  }

  /** 拆出文字单元（只拆一次，结果记在元素上） */
  private unitCache = new WeakMap<Element, { by: string; units: Element[] }>();

  private textUnits(el: Element, by: 'letter' | 'word'): Element[] {
    const cached = this.unitCache.get(el);
    if (cached && cached.by === by) return cached.units;
    const doc = el.ownerDocument;
    const units: Element[] = [];
    for (const text of Array.from(el.querySelectorAll('text'))) {
      const walker = doc.createTreeWalker(text, 4 /* NodeFilter.SHOW_TEXT */);
      const nodes: Text[] = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
      for (const node of nodes) {
        const str = node.data;
        if (!str) continue;
        const parts = by === 'letter' ? Array.from(str) : str.match(/\S+\s*|\s+/g) ?? [str];
        const frag = doc.createDocumentFragment();
        for (const part of parts) {
          const t = doc.createElementNS('http://www.w3.org/2000/svg', 'tspan');
          t.textContent = part;
          frag.appendChild(t);
          if (part.trim()) units.push(t);
        }
        node.parentNode!.replaceChild(frag, node);
      }
    }
    this.unitCache.set(el, { by, units });
    return units;
  }

  private pendingCleanups: (() => void)[] = [];

  /** 每个元素累计的强调/路径状态（跳转时从头重算，保证确定性） */
  private states = new Map<Element, { tx: number; ty: number; sx: number; sy: number; rot: number }>();

  private transformOf(st: { tx: number; ty: number; sx: number; sy: number; rot: number }) {
    return `translate(${st.tx}px,${st.ty}px) rotate(${st.rot}deg) scale(${st.sx},${st.sy})`;
  }

  /** 应用强调动画的最终状态；animate 为真时做过渡 */
  private applyTarget(el: Element, to: AnimTarget, animate: boolean, dur: number, delay: number) {
    const cur = this.states.get(el) ?? { tx: 0, ty: 0, sx: 1, sy: 1, rot: 0 };
    const next = { ...cur };
    if (to.move) { next.tx += to.move[0]; next.ty += to.move[1]; }
    if (to.scale) { next.sx *= to.scale[0]; next.sy *= to.scale[1]; }
    if (to.rotate) next.rot += to.rotate;
    this.states.set(el, next);
    const h = el as HTMLElement;
    const canAnimate = animate && typeof h.animate === 'function' && dur > 0;
    if (to.move || to.scale || to.rotate || to.keys) {
      const from = this.transformOf(cur), end = this.transformOf(next);
      h.style.transform = end;
      if (canAnimate && to.keys && to.keys.length > 1) {
        // 脉冲、跷跷板这类过程有往返的强调动画：按采样的关键帧播放
        const frames = to.keys.map((k) => ({ transform: this.transformOf({ ...cur, sx: cur.sx * k.s[0], sy: cur.sy * k.s[1], rot: cur.rot + k.r }), offset: k.o }));
        frames[frames.length - 1].transform = end;
        this.running.push(h.animate(frames, { duration: dur, delay, fill: 'backwards' }));
      } else if (canAnimate && to.path && to.path.length > 2) {
        // 沿路径移动：按累计长度分配关键帧，速度均匀，整体缓入缓出
        const lens = [0];
        for (let i = 1; i < to.path.length; i++) lens.push(lens[i - 1] + Math.hypot(to.path[i][0] - to.path[i - 1][0], to.path[i][1] - to.path[i - 1][1]));
        const total = lens[lens.length - 1] || 1;
        const frames = to.path.map((p, i) => ({ transform: this.transformOf({ ...next, tx: cur.tx + p[0], ty: cur.ty + p[1] }), offset: lens[i] / total }));
        frames[0].transform = from;
        frames[frames.length - 1].transform = end;
        this.running.push(h.animate(frames, { duration: dur, delay, easing: 'ease-in-out', fill: 'backwards' }));
      } else if (canAnimate) this.running.push(h.animate([{ transform: from }, { transform: end }], { duration: dur, delay, easing: 'ease-in-out', fill: 'backwards' }));
    }
    if (to.opacity !== undefined) {
      const from = h.style.opacity || '1';
      h.style.opacity = String(to.opacity);
      if (canAnimate) this.running.push(h.animate([{ opacity: from }, { opacity: String(to.opacity) }], { duration: dur, delay, fill: 'backwards' }));
    }
    const recolor = (sel: string, color: string) => {
      for (const node of Array.from(el.querySelectorAll(sel))) {
        const n = node as SVGElement;
        const f = n.getAttribute('fill');
        if (!f || f === 'none' || f.startsWith('url(')) continue;
        const from = n.style.fill || f;
        n.style.fill = color;
        if (canAnimate && typeof n.animate === 'function') this.running.push(n.animate([{ fill: from }, { fill: color }], { duration: dur, delay, fill: 'backwards' }));
      }
    };
    if (to.fill) recolor('path,rect,ellipse,circle,polygon', to.fill);
    if (to.color) recolor('text', to.color);
  }

  private cleanupLater(fn: () => void) {
    this.pendingCleanups.push(fn);
  }

  /** 新指令到达时，把还在播的动画直接跳到结束状态 */
  private finishRunning() {
    for (const fn of this.pendingCleanups) fn();
    this.pendingCleanups = [];
    for (const a of this.running) {
      try { a.finish(); } catch { a.cancel(); }
    }
    this.running = [];
  }

  private buildUi() {
    const doc = this.root.ownerDocument;
    const ui = doc.createElement('div');
    ui.className = 'unppt-ui';
    const btn = (label: string, title: string, fn: () => void) => {
      const b = doc.createElement('button');
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      ui.appendChild(b);
    };
    btn('‹', '上一步', () => this.prev());
    this.counter = doc.createElement('span');
    ui.appendChild(this.counter);
    btn('›', '下一步', () => this.next());
    this.root.appendChild(ui);
  }

  private updateUi() {
    if (this.counter) this.counter.textContent = `${this.slideIdx + 1} / ${this.deck.slideCount}`;
  }

  private bindInput() {
    const doc = this.root.ownerDocument;
    if (this.opts.clickToNext !== false) {
      this.root.addEventListener('click', (e) => {
        const t = e.target as Element;
        if (t.closest('video,audio,a,button')) return;
        if (this.fireTrigger(t)) return;
        const link = t.closest('[data-link],[data-href]');
        if (link) { this.follow(link); return; }
        this.next();
      });
    }
    if (this.opts.keyboard !== false) {
      const onKey = (e: KeyboardEvent) => {
        if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
        const k = e.key;
        if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ' || k === 'Enter') { this.next(); e.preventDefault(); }
        else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'Backspace') { this.prev(); e.preventDefault(); }
        else if (k === 'Home') { this.goto(0, 0); e.preventDefault(); }
        else if (k === 'End') { this.goto(this.deck.slideCount - 1, 0); e.preventDefault(); }
      };
      doc.addEventListener('keydown', onKey);
      this.cleanup.push(() => doc.removeEventListener('keydown', onKey));
    }
    // 触屏左右滑动翻页
    let sx = 0, sy = 0, st = 0;
    this.root.addEventListener('touchstart', (e) => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; st = Date.now(); }, { passive: true });
    this.root.addEventListener('touchend', (e) => {
      const t = e.changedTouches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (Date.now() - st < 600 && Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (dx < 0) this.next(); else this.prev();
        e.preventDefault();
      }
    });
  }
}

// ---------------------------------------------------------------- bridge

export interface UnpptApi {
  next(): Promise<PlayerState>;
  prev(): Promise<PlayerState>;
  goto(target: { slide?: number; step?: number } | number, step?: number): Promise<PlayerState>;
  getState(): Promise<PlayerState>;
  on(event: string, fn: Listener): () => void;
  off(event: string, fn: Listener): void;
  /** 原生 App 用：传入 JSON 字符串形式的指令，返回 JSON 字符串形式的回复 */
  handle(message: string | BridgeCommand): string;
  player: Player;
}

interface NativeHosts {
  webkit?: { messageHandlers?: { unppt?: { postMessage(m: unknown): void } } };
  UnpptNative?: { postMessage(m: string): void };
  ReactNativeWebView?: { postMessage(m: string): void };
}

function runCommand(player: Player, cmd: BridgeCommand): PlayerState {
  const args = cmd.args ?? {};
  switch (cmd.cmd) {
    case 'next': return player.next();
    case 'prev': return player.prev();
    case 'goto': return player.goto(args.slide ?? 0, args.step ?? 0);
    case 'getState': return player.getState();
    default: throw new Error(`未知指令：${String((cmd as { cmd: unknown }).cmd)}`);
  }
}

export function installBridge(win: Window, player: Player, allowedOrigins: string[] | null): UnpptApi {
  const native = win as unknown as NativeHosts;
  const toNative = (msg: BridgeEvent | BridgeReply) => {
    const json = JSON.stringify(msg);
    try { native.webkit?.messageHandlers?.unppt?.postMessage(json); } catch { /* 忽略 */ }
    try { native.UnpptNative?.postMessage(json); } catch { /* 忽略 */ }
    try { native.ReactNativeWebView?.postMessage(json); } catch { /* 忽略 */ }
  };
  const toParent = (msg: BridgeEvent | BridgeReply, origin = '*') => {
    if (win.parent && win.parent !== win) {
      try { win.parent.postMessage(msg, origin); } catch { /* 忽略 */ }
    }
  };
  const replyOrigin = (o: string) => (o && o !== 'null' ? o : '*');
  const sendEvent = (event: BridgeEvent['event'], data: PlayerState) => {
    const msg: BridgeEvent = { unppt: 1, event, data };
    if (allowedOrigins && allowedOrigins.length) for (const o of allowedOrigins) toParent(msg, o);
    else toParent(msg);
    toNative(msg);
  };
  player.on('change', (s) => sendEvent('change', s));
  player.on('end', (s) => sendEvent('end', s));
  player.on('link', (s) => sendEvent('link', s));

  const exec = (cmd: BridgeCommand): BridgeReply => {
    try {
      return { unppt: 1, re: cmd.id ?? 0, ok: true, result: runCommand(player, cmd) };
    } catch (e) {
      return { unppt: 1, re: cmd.id ?? 0, ok: false, error: (e as Error).message };
    }
  };

  win.addEventListener('message', (e: MessageEvent) => {
    const d = e.data as BridgeCommand | undefined;
    if (!d || typeof d !== 'object' || d.unppt !== 1 || typeof d.cmd !== 'string') return;
    if (allowedOrigins && allowedOrigins.length && !allowedOrigins.includes(e.origin)) return;
    const reply = exec(d);
    const src = e.source as Window | null;
    try { src?.postMessage(reply, replyOrigin(e.origin)); } catch { /* 忽略 */ }
  });

  const api: UnpptApi = {
    player,
    next: async () => player.next(),
    prev: async () => player.prev(),
    goto: async (target, step) => (typeof target === 'number' ? player.goto(target, step ?? 0) : player.goto(target.slide ?? 0, target.step ?? 0)),
    getState: async () => player.getState(),
    on: (ev, fn) => player.on(ev, fn),
    off: (ev, fn) => player.off(ev, fn),
    handle(message) {
      let cmd: BridgeCommand;
      try { cmd = typeof message === 'string' ? JSON.parse(message) : message; } catch {
        return JSON.stringify({ unppt: 1, re: 0, ok: false, error: '指令不是合法的 JSON' });
      }
      const reply = exec({ ...cmd, unppt: 1 });
      toNative(reply);
      return JSON.stringify(reply);
    },
  };
  // 通知宿主已就绪
  setTimeout(() => sendEvent('ready', player.getState()), 0);
  return api;
}

// ---------------------------------------------------------------- 启动

function checkFormat(meta: { format?: string; version?: number }) {
  if (meta.format !== DECK_FORMAT) throw new Error('不是 unppt 演示数据');
  if ((meta.version ?? 0) > DECK_FORMAT_VERSION) throw new Error(`演示数据版本 ${meta.version} 太新，请升级播放器`);
}

/** 单独部署时使用：mount(元素, deck 对象) */
export function mount(el: HTMLElement, deck: { format: string; version: number; width: number; height: number; slides: DeckSlide[]; title?: string; fonts?: { family: string; weight?: string; style?: string; url?: string }[] }, opts: MountOptions & { baseUrl?: string } = {}): Player {
  checkFormat(deck);
  // 只输出数据时，字体和媒体是相对 deck.json 的路径
  const base = opts.baseUrl ?? '';
  loadFonts(el.ownerDocument, (deck.fonts ?? []).filter((f) => f.url).map((f) => ({ family: f.family, weight: f.weight, style: f.style, src: base + f.url })));
  return new Player(el, { ...deck, slideCount: deck.slides.length, slide: (i) => deck.slides[i] }, opts);
}

/** 注册嵌入的字体（文字位置在转码时已经算好，字体加载完成后浏览器会自动重绘，不需要重新排版） */
function loadFonts(doc: Document, fonts: { family: string; weight?: string; style?: string; src: string }[]) {
  const FF = (doc.defaultView as unknown as { FontFace?: typeof FontFace }).FontFace;
  for (const f of fonts) {
    try {
      if (FF && doc.fonts) {
        const face = new FF(f.family, `url(${f.src})`, { weight: f.weight ?? 'normal', style: f.style ?? 'normal' });
        doc.fonts.add(face);
        face.load().catch(() => {});
      } else {
        const st = doc.createElement('style');
        st.textContent = `@font-face{font-family:'${f.family}';src:url(${f.src});font-weight:${f.weight ?? 'normal'};font-style:${f.style ?? 'normal'}}`;
        doc.head.appendChild(st);
      }
    } catch { /* 字体加载失败时用回退字体显示 */ }
  }
}

function readParams(win: Window) {
  const q = new URLSearchParams(win.location.search);
  const num = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined);
  const origins = q.get('origin');
  return {
    slide: num('slide'), step: num('step'),
    ui: q.get('ui') !== '0',
    origins: origins ? origins.split(',').map((s) => s.trim()).filter(Boolean) : null,
  };
}

function autoBoot() {
  const doc = typeof document !== 'undefined' ? document : undefined;
  const metaEl = doc?.getElementById('unppt-meta');
  const host = doc?.getElementById('unppt');
  if (!doc || !metaEl || !host) return;
  const win = doc.defaultView!;
  doc.documentElement.style.height = '100%';
  doc.body.style.cssText += ';margin:0;height:100%;background:#000';
  host.style.cssText += ';width:100%;height:100%';
  try {
    const meta = JSON.parse(metaEl.textContent ?? '{}');
    checkFormat(meta);
    const scripts = Array.from(doc.querySelectorAll('script.unppt-slide'));
    const assetEls = new Map<string, Element>();
    for (const el of Array.from(doc.querySelectorAll('script.unppt-asset'))) assetEls.set(el.getAttribute('data-id') ?? '', el);
    const assetCache = new Map<string, string>();
    const asset = (id: string) => {
      let v = assetCache.get(id);
      if (v === undefined) {
        v = JSON.parse(assetEls.get(id)?.textContent ?? '""') as string;
        assetCache.set(id, v);
      }
      return v;
    };
    const cache = new Map<number, DeckSlide>();
    const deck: DeckLike = {
      ...meta,
      slideCount: scripts.length,
      slide(i) {
        let s = cache.get(i);
        if (!s) {
          s = JSON.parse(scripts[i].textContent ?? '{}') as DeckSlide;
          // 共享图片：把 unppt:asset/编号 换成真正的数据
          s.svg = s.svg.replace(/unppt:asset\/(\d+)/g, (_m, id: string) => asset(id));
          // 只缓存附近几页，几百页的大文件也不会占太多内存
          if (cache.size > 8) cache.delete(cache.keys().next().value as number);
          cache.set(i, s);
        }
        return s;
      },
    };
    const fontEls = Array.from(doc.querySelectorAll('script.unppt-font'));
    const metaFonts: { family: string; weight?: string; style?: string }[] = meta.fonts ?? [];
    loadFonts(doc, fontEls.map((el) => {
      const family = el.getAttribute('data-family') ?? '';
      const m = metaFonts.find((f) => f.family === family);
      return { family, weight: m?.weight, style: m?.style, src: `data:font/woff;base64,${JSON.parse(el.textContent ?? '""')}` };
    }));
    const p = readParams(win);
    const player = new Player(host, deck, { slide: p.slide, step: p.step, ui: p.ui });
    const api = installBridge(win, player, p.origins);
    (win as unknown as { unppt: UnpptApi }).unppt = api;
  } catch (e) {
    host.innerHTML = `<div class="unppt-error">无法播放：${(e as Error).message}</div>`;
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoBoot);
  else autoBoot();
}
