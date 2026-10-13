/** 自带的翻页按钮和页码（鼠标移上去才显示） */
export class Controls {
  private counter: HTMLElement;

  constructor(root: HTMLElement, onPrev: () => void, onNext: () => void) {
    const doc = root.ownerDocument;
    const ui = doc.createElement('div');
    ui.className = 'unppt-ui';
    const btn = (label: string, title: string, fn: () => void) => {
      const b = doc.createElement('button');
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      ui.appendChild(b);
    };
    btn('‹', '上一步', onPrev);
    this.counter = doc.createElement('span');
    ui.appendChild(this.counter);
    btn('›', '下一步', onNext);
    root.appendChild(ui);
  }

  update(slideIdx: number, slideCount: number) {
    this.counter.textContent = `${slideIdx + 1} / ${slideCount}`;
  }
}
