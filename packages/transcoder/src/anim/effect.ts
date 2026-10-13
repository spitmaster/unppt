/** 单个动画效果（p:par 里的一个效果节点）-> AnimAction：效果类型、方向、时长、延迟、终态、逐字 */
import type { AnimAction, AnimEffect } from '../../../format/src/index';
import { attr, child, findAll, numAttr, type XEl } from '../io/xml';
import { finalState, transformTimeline, type AnimContext } from './emphasis';
import { delayOf } from './timing-util';

/** PowerPoint 的预设效果编号 -> 播放器的效果（没列出的进入/退出效果按淡入淡出） */
const EFFECT_BY_ID: Record<number, AnimEffect> = {
  1: 'appear', 2: 'fly', 3: 'wipe', 4: 'zoom', 5: 'fade', 6: 'zoom', 7: 'fly', 8: 'zoom', 9: 'fade', 10: 'fade',
  12: 'fly', 13: 'zoom', 14: 'fade', 16: 'split', 17: 'zoom', 18: 'wipe', 21: 'wheel', 22: 'wipe', 23: 'zoom',
  24: 'random', 26: 'fly', 37: 'float', 42: 'float', 47: 'float', 53: 'zoom', 55: 'zoom',
};

function dirFromSubtype(sub: number | undefined): AnimAction['from'] {
  switch (sub) {
    case 1: return 't';
    case 2: return 'r';
    case 4: return 'b';
    case 8: return 'l';
    case 3: case 6: return 'r';
    case 9: case 12: return 'l';
    default: return 'b';
  }
}

export function effectAction(eff: XEl, base: number, ctx: AnimContext): AnimAction | undefined {
  const cTn = child(eff, 'p:cTn');
  const cls = attr(cTn, 'presetClass');
  if (!cls) return undefined;
  const spTgt = findAll(cTn, 'p:spTgt')[0];
  const spid = attr(spTgt, 'spid');
  if (!spid || !/^\d{1,10}$/.test(spid)) return undefined;
  const pRg = child(child(spTgt, 'p:txEl'), 'p:pRg');
  const st = attr(pRg, 'st') ?? '0';
  const uid = pRg && /^\d{1,6}$/.test(st) ? `s${spid}p${st}` : `s${spid}`;
  let dur = 0;
  for (const b of findAll(cTn, 'p:cTn')) {
    const d = attr(b, 'dur');
    if (d && d !== 'indefinite') dur = Math.max(dur, Number(d) + delayOf(b));
  }
  const id = numAttr(cTn, 'presetID') ?? 0;
  if (cls === 'mediacall') {
    // 媒体命令：playFrom(秒) / pause / stop / togglePause
    const cmd = attr(findAll(cTn, 'p:cmd')[0], 'cmd') ?? '';
    const m = /playFrom\(([\d.]+)\)/.exec(cmd);
    const media: AnimAction['media'] = m || cmd === 'play' ? 'play' : cmd === 'pause' ? 'pause' : cmd === 'stop' ? 'stop' : cmd === 'togglePause' ? 'toggle' : undefined;
    if (!media) return undefined;
    return { uid, effect: 'media', dir: 'emph', dur: 0, delay: base + delayOf(cTn), media, ...(m ? { start: Number(m[1]) } : {}) };
  }
  const dir: AnimAction['dir'] = cls === 'entr' ? 'in' : cls === 'exit' ? 'out' : 'emph';
  let effect: AnimEffect = cls === 'emph' ? 'emphasis' : cls === 'path' ? 'path' : EFFECT_BY_ID[id] ?? 'fade';
  if (dir !== 'emph' && id === 1) dur = 0;
  if (effect === 'appear') dur = 0;
  const to = dir === 'emph' ? finalState(cTn, ctx) : undefined;
  // 往返、重复的行为实际时长比单段 dur 长
  if (dir === 'emph') dur = Math.max(dur, transformTimeline(cTn).end);
  const iterate = iterateOf(cTn, dur);
  return {
    uid, effect, dir, dur: dur || (effect === 'appear' ? 0 : 500), delay: base + delayOf(cTn),
    from: effect === 'fly' || effect === 'wipe' ? dirFromSubtype(numAttr(cTn, 'presetSubtype')) : undefined,
    ...(to ? { to } : {}),
    ...(iterate ? { iterate } : {}),
  };
}

/** 逐字/逐词：间隔是 tmAbs（毫秒）或 tmPct（单个字时长的百分比，单位 1/1000 %） */
function iterateOf(cTn: XEl | undefined, dur: number): AnimAction['iterate'] {
  const it = child(cTn, 'p:iterate');
  const type = attr(it, 'type');
  if (type !== 'lt' && type !== 'wd') return undefined;
  const abs = numAttr(child(it, 'p:tmAbs'), 'val');
  const pct = numAttr(child(it, 'p:tmPct'), 'val');
  const gap = abs ?? ((pct ?? 0) / 100000) * dur;
  return { by: type === 'lt' ? 'letter' : 'word', gap: Math.max(0, Math.min(gap, 10000)) };
}
