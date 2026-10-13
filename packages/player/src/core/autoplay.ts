/**
 * 按计时自动放映（PowerPoint 的"设置自动换片时间"）。按实测规律：
 *   - 计时从进入这一页开始；
 *   - 这一页的点击步骤自动依次播放（上一步的动画播完就播下一步）；
 *   - 到了换片时间、并且动画都播完，才翻到下一页（取两者中较晚的）。
 * 用户自己翻页、跳转时重新计时。
 */
import type { AnimAction, DeckSlide } from '../../../format/src/index';

export interface AutoPlayHost {
  slide(): DeckSlide;
  stepIndex(): number;
  stepCount(): number;
  /** 播放下一步，或者翻到下一页 */
  next(): void;
}

/** 一组动作播完要多久（毫秒）；一直重复到下一次单击的按播一遍算 */
export function playTime(actions: AnimAction[]): number {
  let end = 0;
  for (const a of actions) {
    const times = (a.repeat && a.repeat > 0 ? a.repeat : 1) * (a.autoRev ? 2 : 1);
    end = Math.max(end, a.delay + a.dur * times);
  }
  return end;
}

export class AutoPlay {
  private timer?: ReturnType<typeof setTimeout>;
  private enteredAt = 0;
  private busyUntil = 0;

  constructor(private host: AutoPlayHost, private enabled: boolean) {}

  /** 进入了一页：busy 是进入时要播的动画（含页面切换）的时长 */
  entered(busy: number) {
    this.enteredAt = Date.now();
    this.busyUntil = this.enteredAt + busy;
    this.schedule();
  }

  /** 播放了一步 */
  played(actions: AnimAction[]) {
    this.busyUntil = Date.now() + playTime(actions);
    this.schedule();
  }

  stop() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule() {
    this.stop();
    const after = this.host.slide().advance?.after;
    if (!this.enabled || after === undefined) return;
    const at = this.host.stepIndex() < this.host.stepCount() ? this.busyUntil : Math.max(this.busyUntil, this.enteredAt + after);
    this.timer = setTimeout(() => { this.timer = undefined; this.host.next(); }, Math.max(0, at - Date.now()));
  }
}
