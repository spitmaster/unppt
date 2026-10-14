/** 放映时的黑屏 / 白屏（PowerPoint：B 或句号黑屏，W 或逗号白屏，再按任意键或点击回到幻灯片） */
export class BlankScreen {
  private readonly el: HTMLDivElement;

  constructor(root: HTMLElement) {
    this.el = root.ownerDocument.createElement('div');
    this.el.className = 'unppt-blank';
    root.appendChild(this.el);
  }

  get active(): boolean {
    return this.el.classList.contains('unppt-show');
  }

  /** 正在显示的颜色（没有黑屏、白屏时是 undefined） */
  get color(): string | undefined {
    return this.active ? this.el.style.background : undefined;
  }

  show(color: string) {
    this.el.style.background = color;
    this.el.classList.add('unppt-show');
  }

  hide() {
    this.el.classList.remove('unppt-show');
  }

  destroy() {
    this.el.remove();
  }
}
