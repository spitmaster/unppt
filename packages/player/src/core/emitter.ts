/** 播放器事件：on / off / emit；监听 '*' 的函数会收到 (事件名, 状态) */
import type { PlayerState } from '../../../format/src/index';

export type Listener = (s: PlayerState) => void;

export class Emitter {
  private listeners = new Map<string, Set<Listener>>();

  on(event: string, fn: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    return () => this.off(event, fn);
  }

  off(event: string, fn: Listener) {
    this.listeners.get(event)?.delete(fn);
  }

  emit(event: string, s: PlayerState) {
    for (const fn of this.listeners.get(event) ?? []) {
      try { fn(s); } catch (e) { console.error(e); }
    }
    for (const fn of this.listeners.get('*') ?? []) {
      try { (fn as unknown as (e: string, s: PlayerState) => void)(event, s); } catch (e) { console.error(e); }
    }
  }
}
