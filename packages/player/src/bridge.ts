/**
 * JS bridge（SPEC F2）：同页 JS（window.unppt）、iframe postMessage（可限制来源）、原生 App WebView。
 * 三种方式共用同一套指令和事件格式（@unppt/format 里的 BridgeCommand / BridgeEvent / BridgeReply）。
 */
import type { BridgeCommand, BridgeEvent, BridgeReply, PlayerState } from '../../format/src/index';
import type { Listener } from './core/emitter';
import type { Player } from './core/player';

export interface UnpptApi {
  next(): Promise<PlayerState>;
  prev(): Promise<PlayerState>;
  goto(target: { slide?: number; step?: number } | number, step?: number): Promise<PlayerState>;
  /** 观看端跟上演绎端的状态（直播课同步） */
  sync(target: Partial<PlayerState> | number, step?: number): Promise<PlayerState>;
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
    case 'sync': return player.sync(args);
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
    sync: async (target, step) => (typeof target === 'number' ? player.sync({ slide: target, step: step ?? 0 }) : player.sync(target)),
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
