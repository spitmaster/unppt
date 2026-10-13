/** 时间节点（p:cTn）的公共读取：开始延迟、是否等点击 */
import { attr, child, children, type XEl } from '../io/xml';

export function delayOf(cTn: XEl | undefined): number {
  const d = attr(child(child(cTn, 'p:stCondLst'), 'p:cond'), 'delay');
  if (!d || d === 'indefinite') return 0;
  const n = Number(d);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 这一组是否要等点击。注意：页面一开始就自动播放的组，PowerPoint 会同时写
 * delay="indefinite" 和 evt="onBegin" 两个条件，后者表示随序列开始自动触发。
 */
export function isClick(cTn: XEl | undefined): boolean {
  const conds = children(child(cTn, 'p:stCondLst'), 'p:cond');
  if (conds.some((c) => attr(c, 'evt') === 'onBegin')) return false;
  return conds.some((c) => attr(c, 'delay') === 'indefinite');
}
