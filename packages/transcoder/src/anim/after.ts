/**
 * "动画播放后"选项（效果节点下的 p:subTnLst，afterEffect="1"）：播放后隐藏、下次单击后隐藏、变暗成某个颜色。
 * masterRel="sameClick" 在这个效果结束时执行，"nextClick" 在下一次单击时执行（实测 PowerPoint 写法）
 */
import type { AnimAction } from '../../../format/src/index';
import { colorIn, css } from '../model/color';
import { attr, child, children, findAll, path, type XEl } from '../io/xml';
import type { AnimContext } from './emphasis';

export function afterEffects(eff: XEl, a: AnimAction, ctx: AnimContext): { same: AnimAction[]; next: AnimAction[] } {
  const out = { same: [] as AnimAction[], next: [] as AnimAction[] };
  for (const sub of children(child(child(eff, 'p:cTn'), 'p:subTnLst'))) {
    const tn = path(sub, 'p:cBhvr', 'p:cTn');
    if (attr(tn, 'afterEffect') !== '1') continue;
    const next = attr(tn, 'masterRel') === 'nextClick';
    const delay = next ? 0 : a.delay + a.dur;
    const names = findAll(sub, 'p:attrName').map((n) => n.text.trim());
    let act: AnimAction | undefined;
    if (sub.name === 'p:set' && names.includes('style.visibility') && attr(path(sub, 'p:to', 'p:strVal'), 'val') === 'hidden') {
      act = { uid: a.uid, effect: 'appear', dir: 'out', dur: 0, delay };
    } else if (sub.name === 'p:animClr') {
      const col = colorIn(child(sub, 'p:to'), ctx.colors);
      if (col) act = { uid: a.uid, effect: 'emphasis', dir: 'emph', dur: 0, delay, to: { dim: css(col) } };
    }
    if (act) (next ? out.next : out.same).push(act);
  }
  return out;
}
