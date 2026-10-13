/** 对元素里的音频/视频执行命令（动画时间线和点击媒体图标共用） */
import type { AnimAction } from '../../format/src/index';

export type MediaCmd = NonNullable<AnimAction['media']>;

export function mediaCommand(el: Element, cmd: MediaCmd, start?: number) {
  const m = el.querySelector('audio,video') as HTMLMediaElement | null;
  if (!m) return;
  try {
    if (cmd === 'play') { if (start !== undefined) m.currentTime = start; void m.play().catch(() => {}); }
    else if (cmd === 'pause') m.pause();
    else if (cmd === 'stop') { m.pause(); m.currentTime = 0; }
    else if (m.paused) void m.play().catch(() => {}); else m.pause();
  } catch { /* 浏览器可能阻止自动播放 */ }
}
