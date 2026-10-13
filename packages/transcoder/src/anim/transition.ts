/** 页面切换（p:transition）-> SlideTransition */
import type { DeckSlide, SlideTransition } from '../../../format/src/index';
import { attr, numAttr, type XEl } from '../io/xml';

export function compileTransition(tr: XEl | undefined): SlideTransition | undefined {
  if (!tr) return undefined;
  const spd = attr(tr, 'spd');
  const durAttr = numAttr(tr, 'p14:dur') ?? numAttr(tr, 'dur');
  const dur = durAttr ?? (spd === 'fast' ? 500 : spd === 'slow' ? 1000 : 750);
  const kind = tr.children.find((c) => /^p(14|15|159)?:/.test(c.name));
  if (!kind) return undefined;
  const local = kind.name.slice(kind.name.indexOf(':') + 1);
  const MAP: Record<string, SlideTransition['type']> = { cut: 'none', push: 'push', wipe: 'wipe', cover: 'cover', pull: 'pull', split: 'split', circle: 'circle', morph: 'morph' };
  const type = MAP[local] ?? 'fade';
  if (type === 'none') return { type, dur: 0 };
  const out: SlideTransition = { type, dur };
  const dir = attr(kind, 'dir');
  if (type === 'push' || type === 'wipe' || type === 'cover' || type === 'pull') {
    out.dir = dir === 'r' || dir === 'u' || dir === 'd' ? dir : 'l';
  } else if (type === 'split') {
    out.orient = attr(kind, 'orient') === 'vert' ? 'vert' : 'horz';
    out.inOut = dir === 'in' ? 'in' : 'out';
  }
  return out;
}

/** 换片方式：p:transition 上的 advTm（自动换片时间，毫秒）、advClick（单击是否换片，默认是） */
export function compileAdvance(tr: XEl | undefined): DeckSlide['advance'] {
  const after = numAttr(tr, 'advTm');
  const noClick = attr(tr, 'advClick') === '0' || attr(tr, 'advClick') === 'false';
  if (after === undefined && !noClick) return undefined;
  return { ...(after !== undefined && after >= 0 ? { after: Math.min(after, 86400000) } : {}), ...(noClick ? { click: false as const } : {}) };
}
