/**
 * 逐帧画的切换（软边遮罩、图块裁剪）：每帧按进度改样式，返回一个只负责计时的动画，
 * 播放器照常管理它（跳到结束、取消都会触发收尾）。
 */

/** paint(u) 的 u 是 0~1 的线性进度；动画结束或取消时调用 reset 恢复样式 */
export function driven(el: HTMLElement, dur: number, paint: (u: number) => void, reset: () => void): Animation {
  const a = el.animate([], { duration: dur });
  let raf = 0;
  const tick = () => {
    const t = a.currentTime;
    paint(typeof t === 'number' ? Math.max(0, Math.min(1, t / dur)) : 1);
    raf = requestAnimationFrame(tick);
  };
  // 先画第 0 帧，避免新页完整地闪一下
  paint(0);
  raf = requestAnimationFrame(tick);
  const end = () => {
    cancelAnimationFrame(raf);
    reset();
  };
  a.addEventListener('finish', end);
  a.addEventListener('cancel', end);
  return a;
}
