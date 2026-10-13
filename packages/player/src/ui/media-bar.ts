/**
 * 音视频控制条：和 PowerPoint 放映时一样，鼠标移到视频或音频图标上时在它下方出现（触屏上点一下出现）：
 * 播放/暂停、拖动进度、当前时间 / 总时长。点在控制条上不会翻页；剪裁过的媒体只在剪裁范围里拖动。
 */
import { toggleMedia } from '../media';

const fmt = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${r < 10 ? '0' : ''}${r}`;
};

export class MediaBar {
  private readonly bar: HTMLDivElement;
  private readonly btn: HTMLButtonElement;
  private readonly seek: HTMLInputElement;
  private readonly time: HTMLSpanElement;
  private media?: HTMLMediaElement;
  private hideTimer?: ReturnType<typeof setTimeout>;
  private readonly update = () => this.refresh();

  constructor(private root: HTMLElement) {
    const doc = root.ownerDocument;
    this.bar = doc.createElement('div');
    this.bar.className = 'unppt-mbar';
    this.btn = doc.createElement('button');
    this.btn.type = 'button';
    this.btn.setAttribute('aria-label', '播放 / 暂停');
    this.seek = doc.createElement('input');
    this.seek.type = 'range';
    this.seek.min = '0';
    this.seek.max = '1000';
    this.seek.value = '0';
    this.seek.setAttribute('aria-label', '进度');
    this.time = doc.createElement('span');
    this.bar.append(this.btn, this.seek, this.time);
    root.appendChild(this.bar);
    // 控制条上的操作不翻页
    for (const ev of ['click', 'pointerdown', 'touchstart', 'touchend'] as const) this.bar.addEventListener(ev, (e) => e.stopPropagation());
    this.bar.addEventListener('pointerenter', () => this.cancelHide());
    this.bar.addEventListener('pointerleave', () => this.hideSoon());
    this.btn.addEventListener('click', () => {
      const m = this.media;
      if (!m) return;
      toggleMedia(m);
    });
    this.seek.addEventListener('input', () => {
      const m = this.media;
      if (!m) return;
      const [a, b] = this.span(m);
      if (b > a) m.currentTime = a + ((b - a) * Number(this.seek.value)) / 1000;
    });
  }

  /** 新的一页显示出来后调用：给页面里的音视频（点击切换播放的那一层）绑定悬停 */
  attach(page: Element) {
    this.hide();
    for (const g of Array.from(page.querySelectorAll('[data-link="media"]'))) {
      g.addEventListener('pointerenter', (e) => this.show(g, (e as PointerEvent).pointerType !== 'mouse'));
      g.addEventListener('pointerleave', () => this.hideSoon());
    }
  }

  hide() {
    this.cancelHide();
    this.bar.classList.remove('unppt-show');
    this.bind(undefined);
  }

  /** touch：触屏、触控笔没有"移开"，几秒后自动隐藏 */
  private show(target: Element, touch: boolean) {
    const m = target.querySelector('video,audio') as HTMLMediaElement | null;
    if (!m) return;
    this.cancelHide();
    this.bind(m);
    const r = target.getBoundingClientRect(), rr = this.root.getBoundingClientRect();
    const w = Math.max(r.width, 200);
    const left = Math.min(Math.max(0, r.left - rr.left + (r.width - w) / 2), Math.max(0, rr.width - w));
    // 放在媒体下方；下方放不下时放在媒体底部里面
    const below = r.bottom - rr.top + 4;
    const top = below + 30 <= rr.height ? below : Math.max(0, r.bottom - rr.top - 34);
    Object.assign(this.bar.style, { left: `${left}px`, top: `${top}px`, width: `${w}px` });
    this.bar.classList.add('unppt-show');
    this.refresh();
    if (touch) this.hideSoon(3000);
  }

  private bind(m: HTMLMediaElement | undefined) {
    if (this.media === m) return;
    for (const ev of ['timeupdate', 'play', 'pause', 'durationchange', 'loadedmetadata']) {
      this.media?.removeEventListener(ev, this.update);
      m?.addEventListener(ev, this.update);
    }
    this.media = m;
  }

  /** 可以拖动的范围（秒）：去掉剪裁的开头和结尾 */
  private span(m: HTMLMediaElement): [number, number] {
    const st = Number(m.dataset.trimStart) || 0, end = Number(m.dataset.trimEnd) || 0;
    const d = isFinite(m.duration) ? m.duration : 0;
    return [st, Math.max(st, d - end)];
  }

  private refresh() {
    const m = this.media;
    if (!m) return;
    const [a, b] = this.span(m);
    this.btn.textContent = m.paused ? '▶' : '❚❚';
    this.seek.value = String(b > a ? Math.round(((m.currentTime - a) / (b - a)) * 1000) : 0);
    this.time.textContent = `${fmt(m.currentTime - a)} / ${fmt(b - a)}`;
  }

  private hideSoon(ms = 1200) {
    this.cancelHide();
    this.hideTimer = setTimeout(() => this.hide(), ms);
  }

  private cancelHide() {
    if (this.hideTimer !== undefined) clearTimeout(this.hideTimer);
    this.hideTimer = undefined;
  }

  destroy() {
    this.hide();
    this.bar.remove();
  }
}
