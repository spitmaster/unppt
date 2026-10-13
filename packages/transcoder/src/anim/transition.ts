/** 页面切换（p:transition）-> SlideTransition */
import type { DeckSlide, SlideTransition } from '../../../format/src/index';
import { attr, numAttr, type XEl } from '../io/xml';
import { transitionSound } from './sound';

type Kind = Omit<SlideTransition, 'dur'>;
type Dir = NonNullable<SlideTransition['dir']>;

const four = (k: XEl): Dir => {
  const d = attr(k, 'dir');
  return d === 'r' || d === 'u' || d === 'd' ? d : 'l';
};
const eight = (k: XEl): Dir => {
  const d = attr(k, 'dir');
  return d === 'r' || d === 'u' || d === 'd' || d === 'lu' || d === 'ru' || d === 'ld' || d === 'rd' ? d : 'l';
};
/** 百叶窗、棋盘、梳理、随机线条的方向写在 dir 里（horz / vert） */
const bars = (type: Kind['type']) => (k: XEl): Kind => ({ type, orient: attr(k, 'dir') === 'vert' ? 'vert' : 'horz' });
const thru = (k: XEl) => attr(k, 'thruBlk') === '1' || attr(k, 'thruBlk') === 'true';
const fade = (k: XEl): Kind => (thru(k) ? { type: 'fade', thruBlk: true } : { type: 'fade' });
const push = (k: XEl): Kind => ({ type: 'push', dir: four(k) });

/**
 * 切换元素（去掉命名空间前缀）-> 播放器的切换。
 * 浏览器里画不了的 3D 效果按观感接近的平面效果（和 PowerPoint 放映截图比过）：
 * 画廊、切换、立方体、盒子按推入，开门、幕布按向外分割，其余按淡入
 */
const KINDS: Record<string, (k: XEl) => Kind> = {
  cut: (k) => (thru(k) ? { type: 'cut', thruBlk: true } : { type: 'none' }),
  fade,
  reveal: fade,
  flash: () => ({ type: 'flash' }),
  push,
  wipe: (k) => ({ type: 'wipe', dir: four(k) }),
  cover: (k) => ({ type: 'cover', dir: eight(k) }),
  pull: (k) => ({ type: 'pull', dir: eight(k) }),
  strips: (k) => {
    const d = attr(k, 'dir');
    return { type: 'strips', dir: d === 'ru' || d === 'ld' || d === 'rd' ? d : 'lu' };
  },
  split: (k) => ({ type: 'split', orient: attr(k, 'orient') === 'vert' ? 'vert' : 'horz', inOut: attr(k, 'dir') === 'in' ? 'in' : 'out' }),
  circle: () => ({ type: 'circle' }),
  diamond: () => ({ type: 'diamond' }),
  plus: () => ({ type: 'plus' }),
  zoom: (k) => ({ type: 'zoom', inOut: attr(k, 'dir') === 'in' ? 'in' : 'out' }),
  wheel: (k) => ({ type: 'wheel', spokes: Math.max(1, Math.min(8, numAttr(k, 'spokes') ?? 4)) }),
  wheelReverse: (k) => ({ type: 'wheel', spokes: Math.max(1, Math.min(8, numAttr(k, 'spokes') ?? 4)), ccw: true }),
  wedge: () => ({ type: 'wedge' }),
  newsflash: () => ({ type: 'newsflash' }),
  blinds: bars('blinds'),
  checker: bars('checker'),
  comb: bars('comb'),
  randomBar: bars('randomBar'),
  dissolve: () => ({ type: 'dissolve' }),
  morph: () => ({ type: 'morph' }),
  // 下面这些按放映实测选了差异最小的近似
  pan: fade, conveyor: fade, ferris: fade, flip: fade,
  gallery: push, switch: push,
  prism: (k) => (attr(k, 'isContent') === '1' ? { type: 'fade' } : push(k)),
  doors: (k) => ({ type: 'split', orient: attr(k, 'dir') === 'horz' ? 'horz' : 'vert', inOut: 'out' }),
  prstTrans: (k) => (attr(k, 'prst') === 'curtains' ? { type: 'split', orient: 'vert', inOut: 'out' } : { type: 'fade' }),
};

/** sounds：切换声音的关系编号 -> 媒体文件路径 */
export function compileTransition(tr: XEl | undefined, sounds?: Map<string, string>): SlideTransition | undefined {
  if (!tr) return undefined;
  const spd = attr(tr, 'spd');
  const durAttr = numAttr(tr, 'p14:dur') ?? numAttr(tr, 'dur');
  const dur = durAttr ?? (spd === 'fast' ? 500 : spd === 'slow' ? 1000 : 750);
  const snd = transitionSound(tr, sounds);
  // 声音（p:sndAc）和扩展（p:extLst）不是切换效果
  const kind = tr.children.find((c) => /^p(14|15|159)?:/.test(c.name) && c.name !== 'p:sndAc' && c.name !== 'p:extLst');
  if (!kind) return snd.sound || snd.stopSound ? { type: 'none', dur: 0, ...snd } : undefined;
  const local = kind.name.slice(kind.name.indexOf(':') + 1);
  const spec: Kind = Object.prototype.hasOwnProperty.call(KINDS, local) ? KINDS[local](kind) : { type: 'fade' };
  return spec.type === 'none' ? { type: 'none', dur: 0, ...snd } : { ...spec, dur, ...snd };
}

/** 换片方式：p:transition 上的 advTm（自动换片时间，毫秒）、advClick（单击是否换片，默认是） */
export function compileAdvance(tr: XEl | undefined): DeckSlide['advance'] {
  const after = numAttr(tr, 'advTm');
  const noClick = attr(tr, 'advClick') === '0' || attr(tr, 'advClick') === 'false';
  if (after === undefined && !noClick) return undefined;
  return { ...(after !== undefined && after >= 0 ? { after: Math.min(after, 86400000) } : {}), ...(noClick ? { click: false as const } : {}) };
}
