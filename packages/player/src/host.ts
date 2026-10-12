/**
 * 宿主页面用的小工具：通过 iframe 控制 unppt 播放器（可跨域）。零依赖。
 *
 *   import { UnpptFrame } from './host.js';
 *   const deck = new UnpptFrame(document.querySelector('iframe'));
 *   await deck.ready;
 *   await deck.goto(3, 0);
 *   deck.on('change', (s) => console.log(s.slide, s.step));
 */
import type { BridgeCommand, BridgeEvent, BridgeReply, PlayerState } from '../../format/src/index';

type Listener = (s: PlayerState) => void;

export class UnpptFrame {
  readonly ready: Promise<PlayerState>;
  private seq = 0;
  private waiting = new Map<number, { ok: (s: PlayerState) => void; fail: (e: Error) => void }>();
  private listeners = new Map<string, Set<Listener>>();
  private onMessage: (e: MessageEvent) => void;

  /** targetOrigin：播放器页面所在的源，默认 '*'；生产环境建议填写具体域名 */
  constructor(private frame: HTMLIFrameElement, private targetOrigin = '*') {
    let resolveReady!: (s: PlayerState) => void;
    this.ready = new Promise((r) => { resolveReady = r; });
    this.onMessage = (e: MessageEvent) => {
      if (e.source !== frame.contentWindow) return;
      const d = e.data as BridgeEvent | BridgeReply;
      if (!d || d.unppt !== 1) return;
      if ('re' in d) {
        const w = this.waiting.get(Number(d.re));
        if (!w) return;
        this.waiting.delete(Number(d.re));
        if (d.ok && d.result) w.ok(d.result); else w.fail(new Error(d.error ?? '指令失败'));
        return;
      }
      if (d.event === 'ready') resolveReady(d.data);
      for (const fn of this.listeners.get(d.event) ?? []) fn(d.data);
    };
    window.addEventListener('message', this.onMessage);
    // 播放器可能比宿主先加载完、错过 ready 事件：主动问一次状态
    frame.addEventListener('load', () => { this.send('getState').then(resolveReady, () => {}); });
  }

  private send(cmd: BridgeCommand['cmd'], args?: BridgeCommand['args']): Promise<PlayerState> {
    const id = ++this.seq;
    return new Promise((ok, fail) => {
      this.waiting.set(id, { ok, fail });
      this.frame.contentWindow?.postMessage({ unppt: 1, id, cmd, args } satisfies BridgeCommand, this.targetOrigin);
      setTimeout(() => {
        if (this.waiting.delete(id)) fail(new Error('播放器没有响应'));
      }, 10000);
    });
  }

  next() { return this.send('next'); }
  prev() { return this.send('prev'); }
  goto(slide: number, step = 0) { return this.send('goto', { slide, step }); }
  getState() { return this.send('getState'); }

  on(event: 'ready' | 'change' | 'end', fn: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    return () => this.listeners.get(event)?.delete(fn);
  }

  destroy() {
    window.removeEventListener('message', this.onMessage);
    for (const w of this.waiting.values()) w.fail(new Error('已销毁'));
    this.waiting.clear();
  }
}
