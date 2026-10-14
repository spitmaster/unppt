/**
 * 直播课同步里除了"第几页第几步"以外的部分（SPEC F2）：触发器播到第几组、黑屏/白屏、页面上音视频的播放状态。
 * 演绎端：这些一变化就通知播放器发 change 事件（状态里带着它们）；观看端：sync 时按状态对齐。
 */
import type { AnimAction, DeckSlide, PlayerState } from '../../../format/src/index';
import type { BlankScreen } from '../ui/blank-screen';

/** 状态里的附加部分 */
export type LiveExtras = Pick<PlayerState, 'blank' | 'triggers' | 'media'>;

export interface LiveHost {
  page(): HTMLElement | undefined;
  data(): DeckSlide | undefined;
  /** 播一组触发器动作：animated 为 false 时直接到结束状态 */
  play(steps: AnimAction[], animated: boolean): void;
  /** 附加部分有变化（发 change 事件） */
  changed(): void;
  blank: BlankScreen;
}

/** 音视频当前时间和演绎端相差超过这么多秒才拖进度（网络延迟下不来回抖动） */
const MEDIA_TOLERANCE = 1.5;

export class LiveState {
  /** 每个触发器已经播到第几组（换页时清零） */
  private triggerIdx = new Map<string, number>();
  private mediaTimer?: ReturnType<typeof setTimeout>;

  constructor(private host: LiveHost) {}

  /** 新的一页显示出来：触发器清零，页面上的音视频播放、暂停、拖进度时通知 */
  enter(page: HTMLElement) {
    this.triggerIdx = new Map();
    const notify = () => {
      if (this.mediaTimer !== undefined) clearTimeout(this.mediaTimer);
      this.mediaTimer = setTimeout(() => this.host.changed(), 50);
    };
    for (const m of mediaOf(page)) for (const ev of ['play', 'pause', 'seeked']) m.el.addEventListener(ev, notify);
  }

  /** 点击了某个元素：是触发器就播它的下一组动作 */
  fire(target: Element, stop: Element): boolean {
    const triggers = this.host.data()?.triggers;
    if (!triggers || !triggers.length) return false;
    for (let el: Element | null = target; el && el !== stop; el = el.parentElement) {
      const uid = el.getAttribute('data-uid');
      const tr = uid ? triggers.find((x) => x.uid === uid) : undefined;
      if (!tr) continue;
      const i = this.triggerIdx.get(tr.uid) ?? 0;
      if (i >= tr.steps.length) return true;
      this.host.play(tr.steps[i], true);
      this.triggerIdx.set(tr.uid, i + 1);
      this.host.changed();
      return true;
    }
    return false;
  }

  extras(): LiveExtras {
    const out: LiveExtras = {};
    const blank = this.host.blank.color;
    if (blank) out.blank = blank;
    if (this.triggerIdx.size) out.triggers = Object.fromEntries(this.triggerIdx);
    const page = this.host.page();
    const media = page ? mediaOf(page).filter((m) => !m.el.paused || m.el.currentTime > 0) : [];
    if (media.length) out.media = media.map((m) => ({ uid: m.uid, playing: !m.el.paused, time: Math.round(m.el.currentTime * 100) / 100 }));
    return out;
  }

  /** 按演绎端的状态对齐：触发器正好下一组时播动画，落后多组时直接到结果；黑屏；音视频 */
  apply(t: LiveExtras) {
    const triggers = this.host.data()?.triggers ?? [];
    for (const [uid, want] of Object.entries(t.triggers ?? {})) {
      const tr = triggers.find((x) => x.uid === uid);
      if (!tr) continue;
      const cur = this.triggerIdx.get(uid) ?? 0;
      const n = Math.min(want, tr.steps.length);
      for (let i = cur; i < n; i++) this.host.play(tr.steps[i], i === n - 1 && n === cur + 1);
      if (n > cur) this.triggerIdx.set(uid, n);
    }
    if (t.blank) this.host.blank.show(t.blank);
    else this.host.blank.hide();
    const page = this.host.page();
    if (!page) return;
    const els = new Map(mediaOf(page).map((m) => [m.uid, m.el]));
    for (const m of t.media ?? []) {
      const el = els.get(m.uid);
      if (!el) continue;
      try {
        if (Math.abs(el.currentTime - m.time) > MEDIA_TOLERANCE) el.currentTime = m.time;
        if (m.playing && el.paused) void el.play().catch(() => {});
        else if (!m.playing && !el.paused) el.pause();
      } catch { /* 浏览器可能阻止自动播放 */ }
    }
  }
}

/** 页面上的音视频和它们所在形状的编号 */
function mediaOf(page: HTMLElement): { uid: string; el: HTMLMediaElement }[] {
  const out: { uid: string; el: HTMLMediaElement }[] = [];
  for (const el of Array.from(page.querySelectorAll('video,audio')) as HTMLMediaElement[]) {
    const uid = el.closest('[data-uid]')?.getAttribute('data-uid');
    if (uid) out.push({ uid, el });
  }
  return out;
}
