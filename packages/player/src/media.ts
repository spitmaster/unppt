/**
 * 音频 / 视频：动画时间线和点击媒体图标都通过这里控制。
 * 跨幻灯片播放（背景音乐）的媒体会被移到常驻容器里，翻页时不停，超出页数范围或跳到范围外时停止。
 */
import type { AnimAction } from '../../format/src/index';

export type MediaCmd = NonNullable<AnimAction['media']>;

export function mediaCommand(el: Element, cmd: MediaCmd, start?: number) {
  const m = el.querySelector('audio,video') as HTMLMediaElement | null;
  if (m) run(m, cmd, start);
}

/** 剪裁（秒）：data-trim-start 从开头剪掉，data-trim-end 从结尾剪掉 */
const trimOf = (m: HTMLMediaElement) => ({ st: Number(m.dataset.trimStart) || 0, end: Number(m.dataset.trimEnd) || 0 });

/** 第一次播放前挂上剪裁：播到剪裁终点就停（循环时回到剪裁起点） */
function prepare(m: HTMLMediaElement) {
  if (m.dataset.trimReady) return;
  m.dataset.trimReady = '1';
  const { st, end } = trimOf(m);
  if (!st && !end) return;
  m.addEventListener('timeupdate', () => {
    // 循环时浏览器从 0 秒重新开始：拉回剪裁起点
    if (st && m.currentTime < st - 0.05) { m.currentTime = st; return; }
    if (!end || !m.duration || m.currentTime < m.duration - end) return;
    if (m.loop) m.currentTime = st;
    else m.pause();
  });
}

function run(m: HTMLMediaElement, cmd: MediaCmd, start?: number) {
  try {
    prepare(m);
    const { st } = trimOf(m);
    // playFrom(x) 的 x 从剪裁起点算；还没播过时也从剪裁起点开始
    if (cmd === 'play') { if (start !== undefined || (st && m.currentTime < st)) m.currentTime = st + (start ?? 0); void m.play().catch(() => {}); }
    else if (cmd === 'pause') m.pause();
    else if (cmd === 'stop') { m.pause(); m.currentTime = st; }
    else if (m.paused) { if (st && m.currentTime < st) m.currentTime = st; void m.play().catch(() => {}); } else m.pause();
  } catch { /* 浏览器可能阻止自动播放 */ }
}

/** 动画引擎看到的媒体控制 */
export interface MediaHost {
  command(el: Element, a: AnimAction): void;
}

/** 跨页播放的媒体：从第 from 页播到第 to 页 */
interface Persistent { uid: string; media: HTMLMediaElement; from: number; to: number }

export class MediaPlayer implements MediaHost {
  private persistent: Persistent[] = [];

  /** keep：常驻容器；slide：当前页码 */
  constructor(private keep: HTMLElement, private slide: () => number) {}

  command(el: Element, a: AnimAction) {
    const m = el.querySelector('audio,video') as HTMLMediaElement | null;
    if (!m) return;
    if (a.loop) m.loop = true;
    if (a.media === 'play' && (a.across ?? 1) > 1) {
      // 同一个背景音乐还在播就不重新开始（比如往回翻到起始页）
      if (this.persistent.some((p) => p.uid === a.uid && !p.media.paused)) return;
      const from = this.slide();
      this.keep.appendChild(m);
      this.persistent.push({ uid: a.uid, media: m, from, to: from + (a.across ?? 1) - 1 });
    }
    run(m, a.media!, a.start);
  }

  /** 换到第 slide 页：页数范围以外的背景音乐停掉 */
  enter(slide: number) {
    this.persistent = this.persistent.filter((p) => {
      if (slide >= p.from && slide <= p.to) return true;
      try { p.media.pause(); } catch { /* 忽略 */ }
      p.media.remove();
      return false;
    });
  }

  stopAll() {
    this.enter(-1);
  }
}
