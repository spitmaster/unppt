/**
 * 音频 / 视频：动画时间线和点击媒体图标都通过这里控制。
 * 跨幻灯片播放（背景音乐）的媒体会被移到常驻容器里，翻页时不停，超出页数范围或跳到范围外时停止。
 */
import type { AnimAction, Sound } from '../../format/src/index';

export type MediaCmd = NonNullable<AnimAction['media']>;

export function mediaCommand(el: Element, cmd: MediaCmd, start?: number) {
  const m = el.querySelector('audio,video') as HTMLMediaElement | null;
  if (m) run(m, cmd, start);
}

/** 切换一个媒体元素的播放 / 暂停（控制条用；和点击媒体一样会挂上剪裁、淡入淡出） */
export const toggleMedia = (m: HTMLMediaElement) => run(m, 'toggle');

/** 剪裁（秒）：data-trim-start 从开头剪掉，data-trim-end 从结尾剪掉 */
const trimOf = (m: HTMLMediaElement) => ({ st: Number(m.dataset.trimStart) || 0, end: Number(m.dataset.trimEnd) || 0 });

/** 淡入、淡出（秒）：播放时每帧按播放位置调音量（剪裁后的开头淡入、结尾淡出） */
function fades(m: HTMLMediaElement) {
  const fin = Number(m.dataset.fadeIn) || 0, fout = Number(m.dataset.fadeOut) || 0;
  if (!fin && !fout) return;
  const win = m.ownerDocument.defaultView;
  let raf = 0;
  const tick = () => {
    const { st, end } = trimOf(m);
    const t = m.currentTime - st, left = (m.duration || Infinity) - end - m.currentTime;
    let v = 1;
    if (fin && t < fin) v = Math.max(0, t / fin);
    if (fout && left < fout) v = Math.min(v, Math.max(0, left / fout));
    m.volume = v;
    raf = m.paused ? 0 : win?.requestAnimationFrame(tick) ?? 0;
  };
  m.addEventListener('play', () => { if (!raf) tick(); });
}

/** 第一次播放前挂上剪裁（播到剪裁终点就停，循环时回到剪裁起点）和淡入淡出 */
function prepare(m: HTMLMediaElement) {
  if (m.dataset.trimReady) return;
  m.dataset.trimReady = '1';
  fades(m);
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

/** 正在全屏播放的视频：原来的视频 -> 盖在整页上的那一份 */
const fullCopies = new WeakMap<HTMLMediaElement, HTMLVideoElement>();

/**
 * 全屏播放（PowerPoint 的"全屏播放"）：在整页上盖一个同样的视频（黑底、等比放满）接着播，
 * 播完、停止或翻页（整页被移除）时去掉，原来的视频停在播到的位置。点它暂停 / 继续，不翻页
 */
function playFull(m: HTMLMediaElement): HTMLVideoElement | undefined {
  const page = m.closest('.unppt-slide');
  if (!page) return undefined;
  const v = m.ownerDocument.createElement('video');
  v.className = 'unppt-full';
  v.src = m.currentSrc || m.src;
  v.playsInline = true;
  for (const k of ['trimStart', 'trimEnd', 'fadeIn', 'fadeOut'] as const) if (m.dataset[k]) v.dataset[k] = m.dataset[k];
  const at = m.currentTime;
  v.addEventListener('loadedmetadata', () => { if (at) v.currentTime = at; }, { once: true });
  const close = () => {
    m.currentTime = v.currentTime;
    fullCopies.delete(m);
    v.remove();
  };
  v.addEventListener('ended', close);
  // 剪裁的终点由 prepare 暂停：暂停在终点也算播完
  v.addEventListener('pause', () => {
    const end = Number(v.dataset.trimEnd) || 0;
    if (v.duration && v.currentTime >= v.duration - end - 0.1) close();
  });
  for (const ev of ['click', 'pointerdown', 'touchstart', 'touchend'] as const) v.addEventListener(ev, (e) => e.stopPropagation());
  v.addEventListener('click', () => (v.paused ? void v.play().catch(() => {}) : v.pause()));
  page.appendChild(v);
  m.pause();
  fullCopies.set(m, v);
  return v;
}

function run(m: HTMLMediaElement, cmd: MediaCmd, start?: number) {
  // 正在全屏播放：命令转给全屏的那一份（停止时把它去掉）
  const copy = fullCopies.get(m);
  if (copy) {
    if (cmd === 'stop') { copy.pause(); fullCopies.delete(m); copy.remove(); m.currentTime = trimOf(m).st; return; }
    run(copy, cmd, start);
    return;
  }
  if (m.dataset.fullScreen && (cmd === 'play' || (cmd === 'toggle' && m.paused))) {
    const v = playFull(m);
    if (v) { run(v, 'play', start); return; }
  }
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
  /** 动画、切换附带的声音：新的声音会停掉正在播的声音 */
  sound?(s: Sound): void;
  stopSound?(): void;
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
    this.stopSound();
  }

  private soundEl?: HTMLAudioElement;

  /** 动画、切换附带的声音：同一时间只有一个，翻页不停（和 PowerPoint 一样），浏览器阻止自动播放时忽略 */
  sound(s: Sound) {
    this.stopSound();
    const doc = this.keep.ownerDocument;
    const a = doc.createElement('audio');
    a.setAttribute('data-unppt-sound', '');
    a.src = s.src;
    if (s.loop) a.loop = true;
    a.addEventListener('ended', () => { if (this.soundEl === a) this.stopSound(); });
    this.keep.appendChild(a);
    this.soundEl = a;
    try { void a.play().catch(() => {}); } catch { /* 忽略 */ }
  }

  stopSound() {
    const a = this.soundEl;
    this.soundEl = undefined;
    if (!a) return;
    try { a.pause(); } catch { /* 忽略 */ }
    a.remove();
  }
}
