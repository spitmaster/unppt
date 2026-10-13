/** 输入：点击画面、键盘、触屏左右滑动 -> 翻页指令；放映习惯：B/W 黑白屏、输入页码回车跳页 */

export interface InputOptions {
  /** 点击画面是否翻到下一步，默认是 */
  clickToNext?: boolean;
  /** 键盘翻页，默认开启 */
  keyboard?: boolean;
}

export interface InputHandlers {
  /** 点击画面上的某个元素（已排除链接、按钮、输入框、媒体控制条） */
  click(target: Element): void;
  next(): void;
  prev(): void;
  first(): void;
  last(): void;
  /** 黑屏 / 白屏：显示纯色、是否正显示、回到幻灯片 */
  blank(color: string): void;
  blanked(): boolean;
  unblank(): void;
  /** 跳到第 n 页（从 1 开始，含隐藏的页） */
  jump(n: number): void;
}

/** 绑定输入，返回解绑函数（挂在 document 上的监听需要在销毁时移除） */
export function bindInput(root: HTMLElement, opts: InputOptions, h: InputHandlers): (() => void)[] {
  const doc = root.ownerDocument;
  const cleanup: (() => void)[] = [];
  if (opts.clickToNext !== false) {
    root.addEventListener('click', (e) => {
      // 黑屏、白屏时点击只回到幻灯片
      if (h.blanked()) { h.unblank(); return; }
      const t = e.target as Element;
      // 点在视频上交给点击处理（切换播放）；链接、按钮、输入框、媒体控制条自己处理
      if (t.closest('a,button,input,.unppt-mbar')) return;
      h.click(t);
    });
  }
  if (opts.keyboard !== false) {
    // 输入的页码（2 秒内没有继续输入就作废）
    let digits = '';
    let digitTimer: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      // 在输入框（比如媒体控制条的进度条）里按方向键是调整它，不翻页
      if ((e.target as Element | null)?.closest?.('input,textarea,select,[contenteditable]')) return;
      const k = e.key;
      // 黑屏、白屏时按任意键只回到幻灯片
      if (h.blanked()) { h.unblank(); e.preventDefault(); return; }
      if (/^[0-9]$/.test(k)) {
        digits += k;
        if (digitTimer !== undefined) clearTimeout(digitTimer);
        digitTimer = setTimeout(() => { digits = ''; }, 2000);
        e.preventDefault();
        return;
      }
      if (k === 'Enter' && digits) { h.jump(Number(digits)); digits = ''; e.preventDefault(); return; }
      digits = '';
      if (k === 'b' || k === 'B' || k === '.') { h.blank('#000'); e.preventDefault(); return; }
      if (k === 'w' || k === 'W' || k === ',') { h.blank('#fff'); e.preventDefault(); return; }
      if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ' || k === 'Enter') { h.next(); e.preventDefault(); }
      else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'Backspace') { h.prev(); e.preventDefault(); }
      else if (k === 'Home') { h.first(); e.preventDefault(); }
      else if (k === 'End') { h.last(); e.preventDefault(); }
    };
    doc.addEventListener('keydown', onKey);
    cleanup.push(() => doc.removeEventListener('keydown', onKey));
  }
  // 触屏左右滑动翻页
  let sx = 0, sy = 0, st = 0;
  root.addEventListener('touchstart', (e) => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; st = Date.now(); }, { passive: true });
  root.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (Date.now() - st < 600 && Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) h.next(); else h.prev();
      e.preventDefault();
    }
  });
  return cleanup;
}
