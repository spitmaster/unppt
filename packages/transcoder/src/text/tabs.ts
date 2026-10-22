/**
 * 制表符：按段落的自定义制表位（a:tabLst，左 / 居中 / 右 / 小数点对齐）算出每个制表符的宽度，
 * 超出最后一个自定义制表位后按默认制表位（defTabSz）。实测：位置从文本框内边距的左侧算起。
 */
import { EMU_PER_PX } from '../model/model';
import { attr, child, children, numAttr, type XEl } from '../io/xml';
import type { Atom } from './types';

interface TabStop { pos: number; algn: string }

export function tabStops(pPr: XEl): TabStop[] {
  return children(child(pPr, 'a:tabLst'), 'a:tab')
    .map((t) => ({ pos: (numAttr(t, 'pos') ?? 0) / EMU_PER_PX, algn: attr(t, 'algn') ?? 'l' }))
    .sort((a, b) => a.pos - b.pos);
}

/** 制表符后面那一段（到下一个制表符或换行）的宽度；toDot 为真时只算到小数点 */
function followingWidth(atoms: Atom[], from: number, toDot: boolean): number {
  let w = 0;
  for (let i = from; i < atoms.length; i++) {
    const a = atoms[i];
    if (a.tab || a.text === '\n' || (toDot && a.text === '.')) break;
    w += a.width;
  }
  return w;
}

/** x0 是第 from 个字（默认是这一段第一个字）的横坐标（相对文本框内边距左侧）；折行后从新一行的第一个字重排（见 linebreak.ts） */
export function layoutTabs(atoms: Atom[], stops: TabStop[], defTab: number, x0: number, from = 0) {
  let x = x0;
  atoms.forEach((a, i) => {
    if (i < from) return;
    if (a.text === '\n') { x = x0; return; }
    if (a.tab) {
      const stop = stops.find((s) => s.pos > x + 0.01);
      if (stop) {
        const w = stop.algn === 'l' ? 0
          : stop.algn === 'r' ? followingWidth(atoms, i + 1, false)
            : stop.algn === 'ctr' ? followingWidth(atoms, i + 1, false) / 2
              : followingWidth(atoms, i + 1, true);
        a.width = Math.max(0, stop.pos - w - x);
      } else {
        a.width = (Math.floor(x / defTab + 1e-6) + 1) * defTab - x;
      }
    }
    x += a.width;
  });
}
